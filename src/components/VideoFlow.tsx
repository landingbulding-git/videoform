import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle, ChevronLeft, Loader2, Volume2, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import Hls from 'hls.js';

type Step = {
  id: string;
  videoUrl: string;
  question: string;
  type: 'multiple-choice' | 'text';
  options?: { label: string; nextStepId: string }[];
  nextStepId?: string;
};

function VideoFlow({ flowData, slug }: { flowData: Step[]; slug: string }) {
  const [searchParams] = useSearchParams();
  const [hiddenFields, setHiddenFields] = useState<Record<string, string>>({});
  
  const [sessionId, setSessionId] = useState<string>('');
  const [currentStepId, setCurrentStepId] = useState<string>(flowData[0].id);
  const [stepHistory, setStepHistory] = useState<string[]>([]);
  const [textInputValue, setTextInputValue] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [isGlobalMuted, setIsGlobalMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isEnded, setIsEnded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize session ID
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  // Initialize hidden fields from URL parameters on mount
  useEffect(() => {
    const fields: Record<string, string> = {};
    const name = searchParams.get('name');
    const email = searchParams.get('email');
    const link = searchParams.get('link');

    if (name) fields.name = name;
    if (email) fields.email = email;
    if (link) fields.link = link;

    setHiddenFields(fields);
  }, [searchParams]);

  // Reset state whenever the slug changes
  useEffect(() => {
    setCurrentStepId(flowData[0].id);
    setStepHistory([]);
    setTextInputValue('');
    setAnswers({});
    setIsSubmitting(false);
    setIsSubmitted(false);
    setIsVideoLoaded(false);
    setIsGlobalMuted(true);
    setIsPlaying(true);
    setIsEnded(false);
    setSessionId(crypto.randomUUID());
  }, [slug, flowData]);

  const currentIndex = flowData.findIndex((step) => step.id === currentStepId);
  const currentStep = flowData[currentIndex] as Step;
  const progress = ((currentIndex + 1) / flowData.length) * 100;

  // Handle HLS and MP4 video loading
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentStep?.videoUrl) return;

    let hls: Hls | null = null;
    let bufferTimeout: NodeJS.Timeout | null = null;

    const handleWaiting = () => {
      bufferTimeout = setTimeout(() => {
        if (hls && hls.currentLevel > 0) {
          console.warn('Buffering > 2s, forcing quality downgrade');
          hls.nextLoadLevel = Math.max(0, hls.currentLevel - 1);
        }
      }, 2000);
    };

    const handlePlaying = () => {
      if (bufferTimeout) clearTimeout(bufferTimeout);
    };

    if (currentStep.videoUrl.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          initialLiveManifestSize: 1,
          maxBufferLength: 30,
          startLevel: -1, // Auto
          abrEwmaDefaultEstimate: 100000, // Force lowest quality initially for instant first frame
        });
        hls.loadSource(currentStep.videoUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          // Cap max resolution at 1080p
          let maxAllowedLevel = -1;
          data.levels.forEach((level, index) => {
            if (level.height <= 1080) {
              maxAllowedLevel = index;
            }
          });
          if (maxAllowedLevel !== -1) {
            hls!.autoLevelCapping = maxAllowedLevel;
          }
          video.play().catch(console.error);
        });

        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = currentStep.videoUrl;
      }
    } else {
      video.src = currentStep.videoUrl;
    }

    return () => {
      if (bufferTimeout) clearTimeout(bufferTimeout);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      if (hls) {
        hls.destroy();
      }
    };
  }, [currentStep?.videoUrl, currentStepId]);

  // Smart Preloader: Headless HLS instances for upcoming videos
  useEffect(() => {
    if (!currentStep || currentStep.type !== 'multiple-choice' || !currentStep.options) return;

    const preloadInstances: Hls[] = [];

    const nextStepIds = Array.from(new Set(
      currentStep.options
        .map(opt => opt.nextStepId)
        .filter(id => id && id !== 'end')
    ));

    nextStepIds.forEach(id => {
      const nextStep = flowData.find(step => step.id === id);
      if (nextStep?.videoUrl?.endsWith('.m3u8')) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            autoStartLoad: true,
            startPosition: 0,
            enableWorker: true, // Use web worker for faster background parsing
            maxBufferLength: 10, // Only buffer a few segments
          });
          hls.loadSource(nextStep.videoUrl);
          preloadInstances.push(hls);
        }
      }
    });

    return () => {
      preloadInstances.forEach(hls => hls.destroy());
    };
  }, [currentStep, flowData]);

  const isLastStep = currentStep?.type === 'multiple-choice' 
    ? (!currentStep.options || currentStep.options.length === 0)
    : (!currentStep?.nextStepId || currentStep.nextStepId === 'end');

  const saveToFirestore = async (currentAnswers: Record<string, string>) => {
    if (!sessionId) return;
    setIsSaving(true);
    try {
      const docRef = doc(db, 'sessions', sessionId);
      await setDoc(docRef, {
        flowSlug: slug,
        hiddenFields,
        answers: currentAnswers,
        updatedAt: serverTimestamp(),
        status: 'in-progress'
      }, { merge: true });
    } catch (error) {
      console.error("Error saving to Firestore:", error);
    } finally {
      setTimeout(() => setIsSaving(false), 800);
    }
  };

  const goToNextStep = (nextId?: string, answer?: string) => {
    let newAnswers = answers;
    if (answer) {
      newAnswers = { ...answers, [currentStep.id]: answer };
      setAnswers(newAnswers);
      
      // Debounce saving to Firestore
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setIsSaving(true);
      saveTimeoutRef.current = setTimeout(() => {
        saveToFirestore(newAnswers);
      }, 500);
    }
    if (nextId && nextId !== 'end') {
      setStepHistory(prev => [...prev, currentStepId]);
      setCurrentStepId(nextId);
      setTextInputValue(''); // Reset text input on step change
      setIsVideoLoaded(false); // Reset video loading state
      setIsPlaying(true);
      setIsEnded(false);
    }
  };

  const goBack = () => {
    if (stepHistory.length > 0) {
      const newHistory = [...stepHistory];
      const prevStepId = newHistory.pop()!;
      setStepHistory(newHistory);
      setCurrentStepId(prevStepId);
      setTextInputValue('');
      setIsVideoLoaded(false);
      setIsPlaying(true);
      setIsEnded(false);
    }
  };

  const handleSubmit = async (finalAnswerData: Record<string, string> = {}) => {
    const finalAnswers = { ...answers, ...finalAnswerData };
    
    // Clear any pending debounced saves
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    
    setIsSubmitting(true);
    try {
      // Save to Firestore first (as in-progress)
      await saveToFirestore(finalAnswers);

      // Continue with Web3Forms submission
      const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY;
      if (!accessKey) {
        console.error("Web3Forms Access Key (VITE_WEB3FORMS_ACCESS_KEY) is missing. Check your environment variables.");
        alert("Config error: Submission service is not properly configured.");
        return;
      }

      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          access_key: accessKey,
          subject: `New VideoAsk Internal Submission: ${slug}`,
          Flow: slug,
          sessionId, // Include session ID in email as well
          ...hiddenFields,
          ...finalAnswers
        })
      });
      
      if (response.ok) {
        setIsSubmitted(true);
        if (sessionId) {
          try {
            const sessionRef = doc(db, 'sessions', sessionId);
            await setDoc(sessionRef, {
              status: 'completed',
              submittedAt: serverTimestamp(),
              answers: finalAnswers
            }, { merge: true });
          } catch (firestoreError) {
            console.error("Error saving final state to Firestore:", firestoreError);
          }
        }
      } else {
        const errorData = await response.json();
        console.error("Submission failed:", errorData);
        alert(`Submission failed: ${errorData.message || "Please try again."}`);
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("An error occurred during submission. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartOver = () => {
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    setCurrentStepId(flowData[0].id);
    setStepHistory([]);
    setTextInputValue('');
    setAnswers({});
    setIsSubmitting(false);
    setIsSubmitted(false);
    setIsVideoLoaded(false);
    setIsGlobalMuted(true);
    setIsPlaying(true);
    setIsEnded(false);
  };

  const handleVideoClick = () => {
    if (isGlobalMuted) {
      setIsGlobalMuted(false);
      setIsEnded(false);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(console.error);
        setIsPlaying(true);
      }
    } else {
      if (videoRef.current) {
        if (isEnded) {
          videoRef.current.currentTime = 0;
          videoRef.current.play().catch(console.error);
          setIsPlaying(true);
          setIsEnded(false);
        } else if (isPlaying) {
          videoRef.current.pause();
          setIsPlaying(false);
        } else {
          videoRef.current.play().catch(console.error);
          setIsPlaying(true);
        }
      }
    }
  };

  if (!currentStep) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-black">
        <p className="text-white/50">A lépés nem található.</p>
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black md:bg-white font-sans text-white md:text-black flex flex-col md:flex-row">
      {/* Progress Bar */}
      <div className="absolute top-0 left-0 w-full h-1.5 bg-white/20 md:bg-gray-200 z-50">
        <div 
          className="h-full bg-white md:bg-black transition-all duration-500 ease-out" 
          style={{ width: `${progress}%` }} 
        />
      </div>

      {/* Left Side (Video Area) */}
      <div className="relative w-full h-full md:w-1/2 md:h-full bg-black flex items-center justify-center overflow-hidden">
        
        {/* Back Button */}
        {stepHistory.length > 0 && !isSubmitted && (
          <button
            onClick={goBack}
            className="absolute top-6 left-4 sm:left-6 z-50 p-3 bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 text-white rounded-full transition-all duration-200 shadow-lg"
            aria-label="Vissza"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Background Video Container */}
        <div 
          className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden cursor-pointer"
          onClick={handleVideoClick}
        >
          {!isVideoLoaded && <Loader2 className="w-8 h-8 text-white/50 animate-spin absolute" />}
          <video
            ref={videoRef}
            autoPlay
            muted={isGlobalMuted}
            playsInline
            onLoadedData={() => setIsVideoLoaded(true)}
            onEnded={() => {
              setIsEnded(true);
              setIsPlaying(false);
            }}
            className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-300 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
          
          {/* Play/Pause Overlay */}
          <AnimatePresence>
            {!isPlaying && !isGlobalMuted && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
              >
                <div className="w-24 h-24 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center">
                  <Play size={48} className="text-white ml-2" fill="currentColor" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Play with Sound Button */}
          <AnimatePresence>
            {isGlobalMuted && isVideoLoaded && !isSubmitted && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleVideoClick();
                  }}
                  className="pointer-events-auto flex flex-col items-center justify-center w-32 h-32 bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white rounded-full transition-all duration-300 shadow-2xl group"
                >
                  <Volume2 size={36} className="mb-2 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-medium tracking-wide text-center px-2">Lejátszás<br/>hanggal</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Gradient Overlay (Mobile only) */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none z-0 md:hidden" />
        </div>
      </div>

      {/* Right Side (Interaction Area) */}
      <div className="absolute bottom-0 left-0 w-full p-4 pb-6 sm:p-8 z-10 flex flex-col justify-end items-center md:relative md:w-1/2 md:h-full md:justify-center md:bg-white md:text-black">
        <AnimatePresence mode="wait">
          <motion.div 
            key={currentStepId}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full max-w-md flex flex-col"
          >
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 md:mb-8 text-white md:text-black drop-shadow-lg md:drop-shadow-none leading-tight text-center">
              {currentStep.question}
            </h2>

            <>
              {/* Multiple Choice Options */}
              {currentStep.type === 'multiple-choice' && currentStep.options && currentStep.options.length > 0 && (
                <div className="w-full mask-fade-y md:mask-none py-1 md:py-0">
                  <div className="flex flex-col gap-2 w-full max-h-[30dvh] md:max-h-none overflow-y-auto hide-scrollbar px-1 pb-2">
                    {currentStep.options.map((option, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          if (!option.nextStepId || option.nextStepId === 'end') {
                            handleSubmit({ [currentStep.id]: option.label });
                          } else {
                            goToNextStep(option.nextStepId, option.label);
                          }
                        }}
                        className="w-full py-3 px-6 bg-white/20 md:bg-gray-50 backdrop-blur-md md:backdrop-blur-none border border-white/30 md:border-gray-200 hover:bg-white/30 md:hover:bg-gray-100 text-white md:text-black rounded-xl md:rounded-2xl font-medium transition-all duration-200 text-center shadow-lg md:shadow-sm shrink-0"
                      >
                        <span className="text-base md:text-lg">{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Text Input */}
              {currentStep.type === 'text' && (
                <div className="w-full flex flex-col items-center relative">
                  <textarea
                    rows={1}
                    value={textInputValue}
                    onChange={(e) => {
                      setTextInputValue(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    className="w-full py-3 px-2 bg-transparent border-b-2 border-white/50 md:border-black/20 text-white md:text-black placeholder-white/50 md:placeholder-black/40 focus:outline-none focus:border-white md:focus:border-black text-xl text-center transition-colors resize-none overflow-y-auto max-h-[140px]"
                    placeholder="Írj ide..."
                    autoFocus
                  />

                  {/* Next Arrow Button */}
                  <div
                    className={`mt-6 transition-all duration-300 ease-in-out ${
                      textInputValue.trim().length > 0
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 translate-y-4 pointer-events-none'
                    }`}
                  >
                    <button
                      onClick={() => {
                        if (isLastStep) {
                          handleSubmit({ [currentStep.id]: textInputValue });
                        } else {
                          goToNextStep(currentStep.nextStepId, textInputValue);
                        }
                      }}
                      disabled={isSubmitting || isSaving}
                      className="p-4 bg-white md:bg-black text-black md:text-white rounded-full hover:bg-gray-200 md:hover:bg-gray-800 transition-colors shadow-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <ArrowRight size={24} />}
                    </button>
                  </div>
                </div>
              )}
            </>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Submitted Overlay */}
      <AnimatePresence>
        {isSubmitted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="flex flex-col items-center"
            >
              <CheckCircle size={80} className="text-green-400 mb-6" />
              <h2 className="text-4xl font-bold text-white mb-2">Köszönjük!</h2>
              <p className="text-white/70 text-lg mb-8">A válaszodat rögzítettük.</p>
              <button
                onClick={handleStartOver}
                className="py-3 px-8 bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white rounded-full font-medium transition-all duration-200 shadow-lg"
              >
                Újrakezdés
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function VideoFlowRoute() {
  const { slug } = useParams<{ slug: string }>();
  
  const [flowData, setFlowData] = useState<Step[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchFlow = async () => {
      setIsLoading(true);
      setError(false);
      try {
        const response = await fetch(`/flows/${slug}.json`);
        if (!response.ok) {
          if (response.status === 404) {
            console.error(`Flow config not found for: ${slug}`);
            throw new Error(`The flow '${slug}' could not be found (404).`);
          }
          throw new Error(`Failed to load flow data (Status: ${response.status})`);
        }
        const data = await response.json();
        setFlowData(data);
      } catch (err) {
        console.error("Fetch Error:", err);
        setError(true);
      } finally {
        setIsLoading(false);
      }
    };

    if (slug) {
      fetchFlow();
    }
  }, [slug]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  if (error || !flowData) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-black">
        <p className="text-white text-xl font-medium">A folyamat nem található</p>
      </div>
    );
  }

  // Use key={slug} to ensure the component completely unmounts and remounts when slug changes,
  // guaranteeing a clean state reset.
  return <VideoFlow key={slug} flowData={flowData} slug={slug!} />;
}
