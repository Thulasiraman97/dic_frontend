'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { startAssessment, submitAssessment, getResult } from '../../services/api';
import QuestionCard from '../../components/Assessment/QuestionCard';
import ProgressBar from '../../components/Assessment/ProgressBar';
import Modal from '../../components/ui/Modal';
import Toast from '../../components/ui/Toast';
import Image from 'next/image';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import InstructionModal from '../../components/Assessment/InstructionModal';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import Confetti from 'react-confetti';
import { motion } from 'framer-motion';

// ─── Send result email via n8n AI agent ──────────────────────────────────────
const N8N_WEBHOOK_URL = 'https://arunpandian1997.app.n8n.cloud/webhook/chat';

async function sendResultEmail(userId, resultData) {
    try {
        const userName  = localStorage.getItem('disc_user_name')  || 'User';
        const userEmail = localStorage.getItem('disc_user_email') || '';
        const userPhone = localStorage.getItem('disc_user_phone') || '';

        if (!userEmail) {
            console.warn('No user email in localStorage — skipping result email.');
            return;
        }

        // Extract all actual scored values
        const percentages    = resultData?.percentages    || {};
        const highestTrait   = resultData?.highestTrait   || '';
        const secondaryTrait = resultData?.secondaryTrait || '';
        const timeTaken      = resultData?.timeTaken      || 0;
        const D = percentages.D ?? 0;
        const I = percentages.I ?? 0;
        const S = percentages.S ?? 0;
        const C = percentages.C ?? 0;

        const traitNames = {
            D: 'Dominance',
            I: 'Influence',
            S: 'Steadiness',
            C: 'Conscientiousness'
        };
        const primaryName   = traitNames[highestTrait]   || highestTrait;
        const secondaryName = traitNames[secondaryTrait] || secondaryTrait;
        const minutesTaken  = Math.max(1, Math.round(timeTaken / 60));

        // Formulate an explicit, self-contained prompt for the n8n AI agent
        const chatMessage = [
            'trigger: assessment_complete',
            '',
            'Please send a personalized DISC assessment result email to the user below using the Gmail send tool.',
            'The email body MUST be rich responsive HTML with inline CSS and visual progress bars.',
            '',
            'USER DETAILS:',
            '- Name: ' + userName,
            '- Email: ' + userEmail,
            '- Phone: ' + userPhone,
            '',
            'DISC SCORES (use EXACTLY these numbers in the email — do not change or estimate):',
            '- D (Dominance):         ' + D + '%',
            '- I (Influence):         ' + I + '%',
            '- S (Steadiness):        ' + S + '%',
            '- C (Conscientiousness): ' + C + '%',
            '',
            'PERSONALITY PROFILE:',
            '- Primary Trait:   ' + highestTrait + ' — ' + primaryName,
            '- Secondary Trait: ' + (secondaryTrait ? secondaryTrait + ' — ' + secondaryName : 'None (single dominant style)'),
            '- Time Taken: ' + minutesTaken + ' minutes',
            '',
            'INSTRUCTIONS:',
            '1. Send email TO: ' + userEmail,
            '2. Subject: Your DISC Futura Behavioral Report is Ready, ' + userName + '!',
            '3. Use your HTML email template. Replace ALL placeholders with exact values:',
            '   - Name: ' + userName,
            '   - Primary Trait: ' + highestTrait + ' (' + primaryName + ')',
            '   - Secondary Trait: ' + (secondaryTrait ? secondaryTrait + ' (' + secondaryName + ')' : 'None'),
            '   - Scores: D=' + D + '%, I=' + I + '%, S=' + S + '%, C=' + C + '%',
            '   - Generate a 3-4 sentence behavioral analysis tailored to this profile',
            '   - Provide 4 key strengths and 2 growth opportunities',
            '4. Pass the raw HTML directly to the Gmail send tool — no markdown fences, no backticks.',
        ].join('\n');

        const payload = {
            chatInput: chatMessage,
            message:   chatMessage,
            sessionId: `result_email_${userId}_${Date.now()}`,
            data: {
                trigger: 'assessment_complete',
                user:    { name: userName, email: userEmail, phone: userPhone },
                result:  { highestTrait, secondaryTrait, percentages: { D, I, S, C }, timeTaken },
            },
        };

        await fetch(N8N_WEBHOOK_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });

        console.log('✅ Result email trigger sent to n8n:', { userName, userEmail, highestTrait, percentages: { D, I, S, C } });
    } catch (err) {
        // Fire-and-forget — never block the success screen
        console.error('Failed to send result email via n8n:', err);
    }
}
// ─────────────────────────────────────────────────────────────────────────────

export default function AssessmentPage() {

    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [questions, setQuestions] = useState([]);
    const [currentPage, setCurrentPage] = useState(0); // Now represents current question index (0-39)
    const [answers, setAnswers] = useState([]); // Array of { qId, answer }
    const [setId, setSetId] = useState(null);
    const [isCompleted, setIsCompleted] = useState(false);

    // Timer State (45 minutes in seconds)
    const [timeLeft, setTimeLeft] = useState(45 * 60);
    const [timerStartTime, setTimerStartTime] = useState(null);

    // Modal State
    const [modalConfig, setModalConfig] = useState({
        isOpen: false,
        title: '',
        message: ''
    });

    // Toast State
    const [toastConfig, setToastConfig] = useState({
        show: false,
        message: ''
    });

    const [showSuccess, setShowSuccess] = useState(false); // Success screen state
    const [showInstructions, setShowInstructions] = useState(false); // New state for instructions

    const isSubmitting = useRef(false);

    const ITEMS_PER_PAGE = 1; // Explicitly set to 1 for one question per page

    // Helper to shuffle array
    const shuffleArray = (array) => {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    };

    // Check for authentication & Fetch Questions OR Restore State
    useEffect(() => {
        const userId = localStorage.getItem('disc_user_id');
        if (!userId) {
            router.push('/login');
            return;
        }

        const restoreOrFetch = async () => {
            try {
                // Try to restore from localStorage
                const savedStateIdx = localStorage.getItem('disc_assessment_state');

                // Check if stored state supports new format (checking if answers have 'most'/'least' pattern or version flag)
                // For simplicity due to breaking change, we will FORCE clear old state if it doesn't match new schema or just once for upgrade.
                // Let's check if the first answer has 'most' property

                if (savedStateIdx) {
                    const savedState = JSON.parse(savedStateIdx);

                    // VALIDATION FOR NEW FORMAT
                    const isNewFormat = savedState.answers && savedState.answers.length > 0 ? savedState.answers[0].most !== undefined : true; // empty is fine

                    // Verify it belongs to current user AND is new format
                    if (savedState.userId === userId && !savedState.isCompleted && isNewFormat) {
                        console.log('Restoring assessment state...');
                        setQuestions(savedState.questions);
                        setSetId(savedState.setId);
                        setAnswers(savedState.answers || []);
                        setCurrentPage(savedState.currentPage || 0);
                        setTimerStartTime(savedState.startTime);

                        // Calculate remaining time
                        const now = Date.now();
                        const elapsedSeconds = Math.floor((now - savedState.startTime) / 1000);
                        const remaining = Math.max(0, (45 * 60) - elapsedSeconds);
                        setTimeLeft(remaining);

                        setLoading(false);
                        return; // Done restoring
                    } else {
                        console.log('Detected old or invalid assessment state. Clearing...');
                        localStorage.removeItem('disc_assessment_state');
                    }
                }

                // If no valid state, fetch new
                console.log('Starting new assessment...');
                const data = await startAssessment(userId);
                if (data && data.questions) {
                    // Shuffle ALL questions once at start
                    const shuffledQuestions = shuffleArray(data.questions);
                    setQuestions(shuffledQuestions);
                    setSetId(data.setId);
                    setCurrentPage(0);

                    // DO NOT SET TIMER START TIME YET - WAIT FOR INSTRUCTIONS
                    setShowInstructions(true);

                    // We don't save to localStorage yet until they click start
                }
            } catch (error) {
                console.error("Failed to load questions", error);
            } finally {
                setLoading(false);
            }
        };

        restoreOrFetch();
    }, [router]);

    // Save progress whenever answers or page changes
    useEffect(() => {
        if (loading || isCompleted || !setId || !timerStartTime) return; // Don't save if timer hasn't started

        const userId = localStorage.getItem('disc_user_id');
        if (!userId) return;

        const stateToSave = {
            userId,
            setId,
            questions, // Saved to ensure order consistency
            answers,
            currentPage,
            startTime: timerStartTime,
            isCompleted: false
        };
        localStorage.setItem('disc_assessment_state', JSON.stringify(stateToSave));
    }, [answers, setId, questions, currentPage, timerStartTime, loading, isCompleted]);

    const handleStartAssessment = () => {
        setShowInstructions(false);
        const now = Date.now();
        setTimerStartTime(now);
        setTimeLeft(45 * 60); // Reset timer to full duration just in case

        // Initialize storage immediately
        const userId = localStorage.getItem('disc_user_id');
        if (userId) {
            const initialState = {
                userId,
                setId,
                questions,
                answers: [],
                currentPage: 0,
                startTime: now,
                isCompleted: false
            };
            localStorage.setItem('disc_assessment_state', JSON.stringify(initialState));
        }
    };


    // Prevent back button navigation - COMPLETELY BLOCK IT
    useEffect(() => {
        if (loading || isCompleted) return;

        // Push a dummy state to prevent back navigation
        window.history.pushState(null, '', window.location.href);

        const handlePopState = (e) => {
            // Block navigation and show toast
            window.history.pushState(null, '', window.location.href);

            // Force close any existing toast first, then show new one
            // This ensures the toast re-triggers even if clicked rapidly
            setToastConfig({ show: false, message: "" });

            // Use setTimeout to ensure state update completes before showing new toast
            setTimeout(() => {
                setToastConfig({
                    show: true,
                    message: "You cannot go back during the assessment. Please complete all questions to proceed."
                });
            }, 10);
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [loading, isCompleted]);

    // Timer Logic - Update every second based on start time
    useEffect(() => {
        if (loading || isCompleted || !timerStartTime) return;

        // Immediate check logic separate from interval to handle load
        const now = Date.now();
        const elapsed = Math.floor((now - timerStartTime) / 1000);
        const rem = Math.max(0, (45 * 60) - elapsed);

        if (rem <= 0) {
            setTimeLeft(0);
            handleSubmit(true); // Force submit
            return;
        }

        const timerId = setInterval(() => {
            const now = Date.now();
            const elapsedSeconds = Math.floor((now - timerStartTime) / 1000);
            const remaining = Math.max(0, (45 * 60) - elapsedSeconds);
            setTimeLeft(remaining);

            if (remaining <= 0) {
                clearInterval(timerId);
                handleSubmit(true);
            }
        }, 1000);

        return () => clearInterval(timerId);
    }, [timerStartTime, loading, isCompleted]);

    // Format Time
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    // Redirect on completion - OLD LOGIC REPLACED BY SUCCESS SCREEN REDIRECT
    /* 
    useEffect(() => {
        if (isCompleted) {
            console.log('Assessment completed, redirecting to results...');
            const timer = setTimeout(() => {
                window.location.href = '/results';
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isCompleted]);
    */

    // Redirect to Dashboard after Success Screen
    useEffect(() => {
        if (showSuccess) {
            const timer = setTimeout(() => {
                window.location.href = '/dashboard';
            }, 5000); // 5 seconds delay for confetti and animation
            return () => clearTimeout(timer);
        }
    }, [showSuccess]);

    const handleAnswer = (qId, type, selectionType) => {
        setAnswers(prev => {
            const existingIndex = prev.findIndex(a => a.qId === qId);
            let newAnswers = [...prev];
            let currentAnswer = existingIndex >= 0 ? { ...newAnswers[existingIndex] } : { qId };

            // Check if this type is already selected for the OTHER category
            if (selectionType === 'most' && currentAnswer.least === type) {
                // Shake animation trigger could go here via state, but handling logic first
                // For now, we simply clear the 'least' if it's the same
                currentAnswer.least = null;
            }
            if (selectionType === 'least' && currentAnswer.most === type) {
                currentAnswer.most = null;
            }

            if (selectionType === 'most') {
                // Toggle off if same, or set new
                currentAnswer.most = currentAnswer.most === type ? null : type;
            } else if (selectionType === 'least') {
                currentAnswer.least = currentAnswer.least === type ? null : type;
            }

            if (existingIndex >= 0) {
                newAnswers[existingIndex] = currentAnswer;
            } else {
                newAnswers.push(currentAnswer);
            }
            return newAnswers;
        });
    };

    const closeModal = () => {
        setModalConfig(prev => ({ ...prev, isOpen: false }));
    };

    const handlePrevPage = () => {
        if (currentPage > 0) {
            // window.scrollTo({ top: 0, behavior: 'smooth' });
            setCurrentPage(prev => prev - 1);
        }
    };

    const handleNextPage = () => {
        if (currentPage < questions.length - 1) {
            // window.scrollTo({ top: 0, behavior: 'smooth' });
            setCurrentPage(prev => prev + 1);
        }
    };

    const jumpToQuestion = (index) => {
        setCurrentPage(index);
    };

    const handleSubmit = async (force = false) => {
        // Validation needed unless forced by timer
        if (!force) {
            // Check if every question has both MOST and LEAST answered
            const unanswered = questions.filter(q => {
                const ans = answers.find(a => a.qId === q.qId);
                return !ans || !ans.most || !ans.least;
            });

            if (unanswered.length > 0) {
                setToastConfig({
                    show: true,
                    message: `⚠️ Please complete ${unanswered.length} pending question${unanswered.length > 1 ? 's' : ''}! Select both 'Most' and 'Least' for each question.`
                });
                return;
            }
        }

        if (isSubmitting.current || isCompleted) return;
        isSubmitting.current = true;
        setLoading(true);

        try {
            const userId = localStorage.getItem('disc_user_id');
            const duration = Math.floor((Date.now() - timerStartTime) / 1000);
            console.log('Assessment Duration (seconds):', duration);

            const result = await submitAssessment(userId, setId, answers, duration);
            console.log('Assessment submitted successfully:', result);

            // CLEAR STATE ON SUCCESS
            localStorage.removeItem('disc_assessment_state');

            setIsCompleted(true);
            setShowSuccess(true); // Trigger success screen
            setLoading(false); // Enable rendering of success screen

            // 📧 Fire-and-forget: fetch result and trigger email via n8n
            try {
                const resultData = await getResult(userId);
                sendResultEmail(userId, resultData || result); // non-blocking
            } catch (e) {
                console.warn('Could not fetch result for email trigger, falling back to submit result:', e.message);
                sendResultEmail(userId, result);
            }

        } catch (error) {
            console.error("Failed to submit", error);
            setModalConfig({
                isOpen: true,
                title: 'Submission Error',
                message: 'There was a problem submitting your assessment. Please try again.'
            });
            setLoading(false);
            isSubmitting.current = false;
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="flex flex-col items-center">
                    <LoadingSpinner size="lg" color="green" />
                    <p className="mt-4 text-green-600 font-mono animate-pulse">
                        {isCompleted ? 'Calculating Results...' : 'Loading Assessment...'}
                    </p>
                </div>
            </div>
        );
    }

    // Success Screen
    if (showSuccess) {
        return (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-white to-green-50 overflow-hidden">
                <Confetti
                    width={window.innerWidth}
                    height={window.innerHeight}
                    recycle={true}
                    numberOfPieces={200}
                />

                <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 20 }}
                    className="bg-white p-12 rounded-full shadow-2xl mb-8 flex items-center justify-center relative"
                >
                    <motion.svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="100"
                        height="100"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-green-500"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.8, delay: 0.2, ease: "easeInOut" }}
                    >
                        <polyline points="20 6 9 17 4 12" />
                    </motion.svg>
                </motion.div>

                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="text-3xl md:text-5xl font-bold text-green-700 text-center max-w-2xl leading-tight"
                >
                    Congratulation! <br /> Assessment has been submitted
                </motion.h1>

                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1 }}
                    className="mt-6 text-zinc-500 text-lg"
                >
                    Redirecting to dashboard...
                </motion.p>
            </div>
        );
    }

    const currentQuestion = questions[currentPage];
    // Use questions length or fallback to 40 if loading (though logic prevents loading state here)
    // The user requirement says "split into 40". If we fetch dynamic questions, we iterate them.
    // Assuming questions array is fully populated.

    return (
        <main className="min-h-screen flex flex-col items-center justify-start p-4 md:p-8 bg-gradient-to-b from-white via-green-50 to-green-100 relative text-zinc-900 transition-colors duration-500">
            <Modal
                isOpen={modalConfig.isOpen}
                onClose={closeModal}
                title={modalConfig.title}
                message={modalConfig.message}
            />

            <InstructionModal
                isOpen={showInstructions}
                onStart={handleStartAssessment}
            />

            <Toast
                message={toastConfig.message}
                isVisible={toastConfig.show}
                onClose={() => setToastConfig({ ...toastConfig, show: false })}
                duration={3000}
            />

            {/* Background Decor - Subtle Green */}
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-green-200/30 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] bg-cyan-200/20 rounded-full blur-[120px]" />
            </div>

            {/* Header / Timer */}
            <div className="z-20 w-full max-w-5xl flex justify-between items-center mb-6 sticky top-4 glass-panel p-4 rounded-2xl border border-green-100 bg-white/80 backdrop-blur-md shadow-sm">
                <div className="flex items-center gap-4">
                    <Image
                        src="/logo-new.png"
                        alt="Inqisity Logo"
                        width={120}
                        height={36}
                        className="object-contain"
                    />
                    <div className="flex flex-col border-l border-zinc-200 pl-4">
                        <h2 className="text-lg font-bold text-green-800">
                            Assessment
                        </h2>
                        <span className="text-xs text-zinc-500 font-medium">Question {currentPage + 1} of {questions.length}</span>
                    </div>
                </div>

                {/* Timer - Centered */}
                <div className={`font-mono text-xl font-bold px-4 py-2 rounded-lg border flex items-center gap-2 ${timeLeft < 300 ? 'text-red-600 border-red-200 bg-red-50' : 'text-green-700 border-green-200 bg-green-50'}`}>
                    <span>⏱</span> {formatTime(timeLeft)}
                </div>

                {/* Powered by Watermark - Right Side */}
                <div className="flex flex-col items-center opacity-90 hover:opacity-100 transition-opacity">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mb-0.5">Powered by</span>
                    <img
                        src="/powered-by.png"
                        alt="Powered By Logo"
                        className="h-5 object-contain animate-pulse"
                    />
                </div>
            </div>

            {/* Progress Bar & Skipped Indicator */}
            <div className="z-20 w-full max-w-4xl mb-8 flex flex-col gap-2">
                <div className="flex justify-between items-end mb-1">
                    <span className="text-sm font-medium text-zinc-500">Progress</span>
                    <div className="flex items-center gap-3">
                        {/* Skipped Badge - Only counts visited but incomplete (red segments) */}
                        {(() => {
                            const skippedCount = questions.filter((q, idx) => {
                                const ans = answers.find(a => a.qId === q.qId);
                                const isComplete = ans && ans.most && ans.least;
                                const isVisited = idx < currentPage; // Only count questions BEFORE current
                                return isVisited && !isComplete; // Only count visited incomplete questions
                            }).length;

                            const completedCount = questions.filter(q => {
                                const ans = answers.find(a => a.qId === q.qId);
                                return ans && ans.most && ans.least;
                            }).length;

                            // Only show badge if user has visited at least one question
                            if (currentPage > 0) {
                                if (skippedCount > 0) {
                                    return (
                                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-600 text-xs font-bold border border-red-200">
                                            <span>⚠️</span> {skippedCount} Skipped
                                        </span>
                                    );
                                } else if (questions.length > 0 && completedCount === questions.length) {
                                    return (
                                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-600 text-xs font-bold border border-green-200">
                                            <span>✓</span> All Complete
                                        </span>
                                    );
                                }
                            }
                            return null;
                        })()}
                        <span className="text-sm font-bold text-green-700">
                            {questions.filter(q => {
                                const ans = answers.find(a => a.qId === q.qId);
                                return ans && ans.most && ans.least;
                            }).length}/{questions.length}
                        </span>
                    </div>
                </div>

                {/* Segmented Progress Bar */}
                <div className="w-full flex gap-1">
                    {questions.map((q, idx) => {
                        const ans = answers.find(a => a.qId === q.qId);
                        const isComplete = ans && ans.most && ans.least;
                        const isVisited = idx < currentPage; // Only questions BEFORE current are considered visited
                        const isIncomplete = isVisited && !isComplete;
                        const isCurrent = idx === currentPage;

                        // Determine color: Gray (unvisited or current), Red (visited but incomplete), Green (complete)
                        let colorClass = 'bg-zinc-200'; // Default: unvisited or current (gray)
                        let statusText = idx === currentPage ? 'Current' : 'Not visited';

                        if (isComplete) {
                            colorClass = 'bg-gradient-to-r from-green-500 to-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]';
                            statusText = 'Complete';
                        } else if (isIncomplete) {
                            colorClass = 'bg-red-400';
                            statusText = 'Skipped';
                        }

                        return (
                            <button
                                key={q.qId}
                                onClick={() => jumpToQuestion(idx)}
                                className={`
                                    flex-1 h-3 rounded-sm transition-all duration-300 cursor-pointer
                                    ${colorClass}
                                    ${isCurrent ? 'ring-2 ring-blue-500 ring-offset-1 scale-110' : 'hover:scale-105'}
                                `}
                                title={`Question ${idx + 1} - ${statusText}`}
                            />
                        );
                    })}
                </div>
            </div>

            {/* Question Card */}
            <div className="z-10 w-full max-w-4xl flex flex-col flex-1 pb-20 justify-center min-h-[400px]">
                {currentQuestion && (
                    <div key={currentQuestion.qId} className="animate-in fade-in slide-in-from-right duration-500">
                        <div className="mb-8">
                            <span className="inline-block px-3 py-1 rounded-full bg-white text-zinc-500 text-sm font-bold mb-4 shadow-sm">
                                Question {currentPage + 1} of {questions.length}
                            </span>
                            <h3 className="text-xl md:text-2xl font-semibold text-zinc-800 leading-tight">
                                {currentQuestion.question}
                            </h3>
                        </div>

                        {/* 3D Flip Container - We will animate the parent div key change */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Left Column - Options A & B */}
                            <div className="flex flex-col gap-3">
                                {currentQuestion.options && currentQuestion.options.slice(0, 2).map((opt, idx) => {
                                    const ans = answers.find(a => a.qId === currentQuestion.qId) || {};
                                    const isMost = ans.most === opt.type;
                                    const isLeast = ans.least === opt.type;
                                    const bothSelected = ans.most && ans.least;
                                    const isGrayedOut = bothSelected && !isMost && !isLeast;

                                    return (
                                        <div
                                            key={idx}
                                            className={`
                                                relative grid grid-cols-[1fr_auto_auto] gap-3 items-center p-3 rounded-xl border transition-all duration-300
                                                ${isGrayedOut ? 'bg-gray-100 border-gray-300 opacity-50' : 'bg-white border-zinc-200 hover:border-green-300 hover:shadow-sm hover:scale-[1.005]'}
                                            `}
                                        >
                                            {/* Statement Text */}
                                            <div className={`
                                                font-medium text-base leading-snug transition-colors
                                                ${isGrayedOut ? 'text-gray-400' : 'text-zinc-700'}
                                            `}>
                                                {opt.text}
                                            </div>

                                            {/* Interaction Area */}
                                            <div className="flex items-center gap-6">
                                                {/* MOST Button */}
                                                <button
                                                    onClick={() => handleAnswer(currentQuestion.qId, opt.type, 'most')}
                                                    className={`
                                                        w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 group
                                                        ${isMost
                                                            ? 'bg-white border-green-400 shadow-lg scale-110'
                                                            : 'border-zinc-200 hover:border-green-400 hover:bg-green-50'
                                                        }
                                                    `}
                                                    title="Most Like Me (+1)"
                                                >
                                                    {isMost ? (
                                                        <span className="text-xl">👍</span>
                                                    ) : (
                                                        <ThumbsUp
                                                            size={20}
                                                            className="text-zinc-300 group-hover:text-green-500 transition-colors duration-300"
                                                        />
                                                    )}
                                                </button>

                                                {/* LEAST Button */}
                                                <button
                                                    onClick={() => handleAnswer(currentQuestion.qId, opt.type, 'least')}
                                                    className={`
                                                        w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 group
                                                        ${isLeast
                                                            ? 'bg-white border-red-400 shadow-lg scale-110'
                                                            : 'border-zinc-200 hover:border-red-400 hover:bg-red-50'
                                                        }
                                                    `}
                                                    title="Least Like Me (-1)"
                                                >
                                                    {isLeast ? (
                                                        <span className="text-xl">👎</span>
                                                    ) : (
                                                        <ThumbsDown
                                                            size={20}
                                                            className="text-zinc-300 group-hover:text-red-500 transition-colors duration-300"
                                                        />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Right Column - Options C & D */}
                            <div className="flex flex-col gap-3">
                                {currentQuestion.options && currentQuestion.options.slice(2, 4).map((opt, idx) => {
                                    const ans = answers.find(a => a.qId === currentQuestion.qId) || {};
                                    const isMost = ans.most === opt.type;
                                    const isLeast = ans.least === opt.type;
                                    const bothSelected = ans.most && ans.least;
                                    const isGrayedOut = bothSelected && !isMost && !isLeast;

                                    return (
                                        <div
                                            key={idx + 2}
                                            className={`
                                                relative grid grid-cols-[1fr_auto_auto] gap-3 items-center p-3 rounded-xl border transition-all duration-300
                                                ${isGrayedOut ? 'bg-gray-100 border-gray-300 opacity-50' : 'bg-white border-zinc-200 hover:border-green-300 hover:shadow-sm hover:scale-[1.005]'}
                                            `}
                                        >
                                            {/* Statement Text */}
                                            <div className={`
                                                font-medium text-base leading-snug transition-colors
                                                ${isGrayedOut ? 'text-gray-400' : 'text-zinc-700'}
                                            `}>
                                                {opt.text}
                                            </div>

                                            {/* Interaction Area */}
                                            <div className="flex items-center gap-6">
                                                {/* MOST Button */}
                                                <button
                                                    onClick={() => handleAnswer(currentQuestion.qId, opt.type, 'most')}
                                                    className={`
                                                        w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 group
                                                        ${isMost
                                                            ? 'bg-white border-green-400 shadow-lg scale-110'
                                                            : 'border-zinc-200 hover:border-green-400 hover:bg-green-50'
                                                        }
                                                    `}
                                                    title="Most Like Me (+1)"
                                                >
                                                    {isMost ? (
                                                        <span className="text-xl">👍</span>
                                                    ) : (
                                                        <ThumbsUp
                                                            size={20}
                                                            className="text-zinc-300 group-hover:text-green-500 transition-colors duration-300"
                                                        />
                                                    )}
                                                </button>

                                                {/* LEAST Button */}
                                                <button
                                                    onClick={() => handleAnswer(currentQuestion.qId, opt.type, 'least')}
                                                    className={`
                                                        w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 group
                                                        ${isLeast
                                                            ? 'bg-white border-red-400 shadow-lg scale-110'
                                                            : 'border-zinc-200 hover:border-red-400 hover:bg-red-50'
                                                        }
                                                    `}
                                                    title="Least Like Me (-1)"
                                                >
                                                    {isLeast ? (
                                                        <span className="text-xl">👎</span>
                                                    ) : (
                                                        <ThumbsDown
                                                            size={20}
                                                            className="text-zinc-300 group-hover:text-red-500 transition-colors duration-300"
                                                        />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation Footer */}
            <div className="fixed bottom-0 left-0 w-full z-30 p-4 bg-white/80 backdrop-blur-lg border-t border-green-100">
                <div className="max-w-4xl mx-auto flex justify-between items-center">
                    <button
                        onClick={handlePrevPage}
                        disabled={currentPage === 0}
                        className={`
                            px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all
                            ${currentPage === 0
                                ? 'text-zinc-400 cursor-not-allowed'
                                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                            }
                        `}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                        </svg>
                        Previous
                    </button>

                    <div className="text-sm text-zinc-400 font-medium hidden md:block">
                        {answers.filter(a => a.most && a.least).length} answered / {questions.length} total
                    </div>

                    {currentPage === questions.length - 1 ? (
                        <button
                            onClick={() => handleSubmit(false)}
                            className="px-10 py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-lg hover:shadow-lg hover:shadow-green-200 hover:-translate-y-0.5 transition-all flex items-center gap-2"
                        >
                            Complete Assessment
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                        </button>
                    ) : (
                        <button
                            onClick={handleNextPage}
                            className="px-8 py-3 rounded-xl bg-zinc-900 text-white font-bold hover:bg-zinc-800 hover:scale-105 transition-all flex items-center gap-2 shadow-lg"
                        >
                            Next Question
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
        </main >
    );
}
