import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle, ChevronLeft, Loader2, Volume2, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type Step = {
  id: string;
  videoUrl: string;
  question: string;
  type: 'multiple-choice' | 'text';
  options?: { label: string; nextStepId: string }[];
  nextStepId?: string;
};

function VideoFlow({ flowData, slug }: { flowData: Step[]; slug: string }) {
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
  const videoRef = useRef<HTMLVideoElement>(null);

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
  }, [slug, flowData]);

  const currentIndex = flowData.findIndex((step) => step.id === currentStepId);
  const currentStep = flowData[currentIndex] as Step;
  const progress = ((currentIndex + 1) / flowData.length) * 100;

  const isLastStep = currentStep?.type === 'multiple-choice' 
    ? (!currentStep.options || currentStep.options.length === 0)
    : (!currentStep?.nextStepId || currentStep.nextStepId === 'end');

  const goToNextStep = (nextId?: string, answer?: string) => {
    if (answer) {
      setAnswers(prev => ({ ...prev, [currentStep.id]: answer }));
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

  const handleSubmit = async () => {
    const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY;
    
    if (!accessKey) {
      console.error("Web3Forms Access Key (VITE_WEB3FORMS_ACCESS_KEY) is missing. Check your environment variables.");
      alert("Config error: Submission service is not properly configured.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          access_key: accessKey,
          subject: `New VideoAsk Internal Submission: ${slug}`,
          Flow: slug, // Include the slug in the form data
          ...answers
        })
      });
      
      if (response.ok) {
        setIsSubmitted(true);
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
            key={currentStepId}
            ref={videoRef}
            src={currentStep.videoUrl}
            autoPlay
            muted={isGlobalMuted}
            playsInline
            onLoadedData={() => setIsVideoLoaded(true)}
            onEnded={() => {
              setIsEnded(true);
              setIsPlaying(false);
            }}
            className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
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
      <div className="absolute bottom-0 left-0 w-full p-6 sm:p-8 z-10 flex flex-col justify-end items-center md:relative md:w-1/2 md:h-full md:justify-center md:bg-white md:text-black">
        <AnimatePresence mode="wait">
          <motion.div 
            key={currentStepId}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full max-w-md flex flex-col"
          >
            <h2 className="text-2xl sm:text-3xl font-bold mb-8 text-white md:text-black drop-shadow-lg md:drop-shadow-none leading-tight text-center">
              {currentStep.question}
            </h2>

            {isLastStep ? (
              <div className="mt-4 w-full flex flex-col items-center">
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="w-full py-4 px-6 bg-white md:bg-black text-black md:text-white rounded-2xl font-bold text-lg transition-colors hover:bg-gray-200 md:hover:bg-gray-800 shadow-lg flex items-center justify-center disabled:opacity-70"
                >
                  {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Beküldés'}
                </button>
              </div>
            ) : (
              <>
                {/* Multiple Choice Options */}
                {currentStep.type === 'multiple-choice' && currentStep.options && currentStep.options.length > 0 && (
                  <div className="flex flex-col gap-3 w-full">
                    {currentStep.options.map((option, index) => (
                      <button
                        key={index}
                        onClick={() => goToNextStep(option.nextStepId, option.label)}
                        className="w-full py-4 px-6 bg-white/20 md:bg-gray-50 backdrop-blur-md md:backdrop-blur-none border border-white/30 md:border-gray-200 hover:bg-white/30 md:hover:bg-gray-100 text-white md:text-black rounded-2xl font-medium transition-all duration-200 text-center shadow-lg md:shadow-sm"
                      >
                        <span className="text-lg">{option.label}</span>
                      </button>
                    ))}
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
                        onClick={() => goToNextStep(currentStep.nextStepId, textInputValue)}
                        className="p-4 bg-white md:bg-black text-black md:text-white rounded-full hover:bg-gray-200 md:hover:bg-gray-800 transition-colors shadow-lg flex items-center justify-center"
                      >
                        <ArrowRight size={24} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
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
