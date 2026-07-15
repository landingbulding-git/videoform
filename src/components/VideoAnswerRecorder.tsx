import { useState, useRef, useEffect } from 'react';
import { Loader2, Video, RotateCcw, Play, Pause, Square, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type RecorderPhase =
  | 'idle'
  | 'requesting-permission'
  | 'previewing'
  | 'recording'
  | 'paused'
  | 'recorded'
  | 'uploading'
  | 'uploaded'
  | 'error'
  | 'unsupported';

type VideoAnswerRecorderProps = {
  sessionId: string;
  stepId: string;
  onUploaded: (publicUrl: string) => void;
};

function pickMimeType(): string | null {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function uploadWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload network error'));

    xhr.send(blob);
  });
}

export default function VideoAnswerRecorder({
  sessionId,
  stepId,
  onUploaded,
}: VideoAnswerRecorderProps) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const recordedBlobRef = useRef<Blob | null>(null);
  const recordedMimeTypeRef = useRef<string>('video/webm');

  // Feature detection on mount
  useEffect(() => {
    const isSupported =
      navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined' &&
      pickMimeType() !== null;

    if (!isSupported) {
      setPhase('unsupported');
    }
  }, []);

  const requestPermission = async () => {
    setPhase('requesting-permission');
    setErrorMessage('');

    try {
      console.log('[VideoAnswerRecorder] Requesting camera permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      console.log('[VideoAnswerRecorder] Got stream:', stream);
      streamRef.current = stream;
      setPhase('previewing');

      // Set srcObject immediately
      if (previewVideoRef.current) {
        console.log('[VideoAnswerRecorder] Setting srcObject immediately');
        previewVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      const errorMsg =
        err instanceof DOMException
          ? err.name === 'NotAllowedError'
            ? 'Camera permission denied. Please allow access to your camera and try again.'
            : err.message
          : 'Failed to access camera. Please check your device settings.';
      console.error('[VideoAnswerRecorder] Permission error:', err);
      setErrorMessage(errorMsg);
      setPhase('error');
    }
  };

  const startRecording = () => {
    if (!streamRef.current) return;

    const mimeType = pickMimeType();
    if (!mimeType) {
      setErrorMessage('Video recording is not supported in your browser.');
      setPhase('error');
      return;
    }

    chunksRef.current = [];
    recordedMimeTypeRef.current = mimeType;

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      recordedBlobRef.current = blob;
      setPhase('recorded');
    };

    recorder.start();
    setPhase('recording');
  };

  const pauseRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.pause();
      setPhase('paused');
    }
  };

  const resumeRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.resume();
      setPhase('recording');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
    }
  };

  const recordAgain = () => {
    // Stop and release current stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
    recordedBlobRef.current = null;
    chunksRef.current = [];
    setPhase('idle');
    setErrorMessage('');
    setUploadProgress(0);
  };


  const useAnswer = async () => {
    if (!recordedBlobRef.current) return;

    setPhase('uploading');
    setUploadProgress(0);

    try {
      const contentType = recordedMimeTypeRef.current;
      const response = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          stepId,
          contentType,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get upload URL');
      }

      const { uploadUrl, publicUrl } = await response.json();

      await uploadWithProgress(
        uploadUrl,
        recordedBlobRef.current,
        contentType,
        setUploadProgress
      );

      setPhase('uploaded');
      setTimeout(() => {
        onUploaded(publicUrl);
      }, 500);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrorMessage(errorMsg);
      setPhase('error');
    }
  };

  const retryUpload = async () => {
    if (!recordedBlobRef.current) return;

    setPhase('uploading');
    setUploadProgress(0);
    setErrorMessage('');

    try {
      const contentType = recordedMimeTypeRef.current;
      const response = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          stepId,
          contentType,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { uploadUrl, publicUrl } = await response.json();

      await uploadWithProgress(
        uploadUrl,
        recordedBlobRef.current,
        contentType,
        setUploadProgress
      );

      setPhase('uploaded');
      setTimeout(() => {
        onUploaded(publicUrl);
      }, 500);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrorMessage(errorMsg);
      setPhase('error');
    }
  };

  if (phase === 'unsupported') {
    return (
      <div className="w-full max-w-md flex flex-col items-center">
        <div className="text-center p-6 bg-white/10 md:bg-gray-50 backdrop-blur-md md:backdrop-blur-none border border-white/30 md:border-gray-200 rounded-xl md:rounded-2xl">
          <Video size={48} className="mx-auto mb-4 text-white/50 md:text-black/50" />
          <p className="text-white md:text-black text-center">
            Videós válasz nem támogatott ezen a böngészőn. Kérjük, válassz szöveges
            választ.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-4">
      <AnimatePresence mode="wait">
        {(phase === 'idle' || phase === 'requesting-permission') && (
          <motion.button
            key="request-btn"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            onClick={requestPermission}
            disabled={phase === 'requesting-permission'}
            className="flex items-center gap-2 py-3 px-6 bg-white/20 md:bg-gray-50 backdrop-blur-md md:backdrop-blur-none border border-white/30 md:border-gray-200 hover:bg-white/30 md:hover:bg-gray-100 text-white md:text-black rounded-xl md:rounded-2xl font-medium transition-all duration-200 text-center shadow-lg md:shadow-sm disabled:opacity-50"
          >
            {phase === 'requesting-permission' ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>Kamera engedély...</span>
              </>
            ) : (
              <>
                <Video size={20} />
                <span>Videó rögzítés</span>
              </>
            )}
          </motion.button>
        )}

        {phase === 'previewing' && (
          <motion.div
            key="previewing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full flex flex-col items-center gap-4"
          >
            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-white/30 md:border-gray-200">
              <video
                ref={previewVideoRef}
                autoPlay
                muted
                playsInline
                style={{ transform: 'scaleX(-1)' }}
                className="w-full h-full object-cover bg-black"
              />
            </div>
            <button
              onClick={startRecording}
              className="flex items-center gap-2 py-3 px-6 bg-red-500/80 hover:bg-red-600 text-white rounded-xl md:rounded-2xl font-medium transition-all duration-200 shadow-lg"
            >
              <Play size={20} />
              <span>Rögzítés indítása</span>
            </button>
          </motion.div>
        )}

        {(phase === 'recording' || phase === 'paused') && (
          <motion.div
            key="recording"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full flex flex-col items-center gap-4"
          >
            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-white/30 md:border-gray-200">
              <video
                ref={previewVideoRef}
                autoPlay
                muted
                playsInline
                style={{ transform: 'scaleX(-1)' }}
                className="w-full h-full object-cover"
              />
              {phase === 'recording' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="flex items-center gap-2 bg-red-600/90 backdrop-blur-sm px-4 py-2 rounded-full">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    <span className="text-white text-sm font-medium">Rögzítés...</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 w-full">
              {phase === 'recording' && (
                <button
                  onClick={pauseRecording}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-white/20 md:bg-gray-100 hover:bg-white/30 md:hover:bg-gray-200 text-white md:text-black rounded-lg font-medium transition-all"
                >
                  <Pause size={18} />
                  <span>Szünet</span>
                </button>
              )}
              {phase === 'paused' && (
                <button
                  onClick={resumeRecording}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-white/20 md:bg-gray-100 hover:bg-white/30 md:hover:bg-gray-200 text-white md:text-black rounded-lg font-medium transition-all"
                >
                  <Play size={18} />
                  <span>Folytatás</span>
                </button>
              )}
              <button
                onClick={stopRecording}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-red-500/80 hover:bg-red-600 text-white rounded-lg font-medium transition-all"
              >
                <Square size={18} />
                <span>Stop</span>
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'recorded' && recordedBlobRef.current && (
          <motion.div
            key="recorded"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full flex flex-col items-center gap-4"
          >
            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-white/30 md:border-gray-200">
              <video
                src={URL.createObjectURL(recordedBlobRef.current)}
                controls
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex gap-2 w-full">
              <button
                onClick={recordAgain}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-white/20 md:bg-gray-50 hover:bg-white/30 md:hover:bg-gray-100 border border-white/30 md:border-gray-200 text-white md:text-black rounded-lg md:rounded-xl font-medium transition-all"
              >
                <RotateCcw size={18} />
                <span>Újra</span>
              </button>
              <button
                onClick={useAnswer}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-green-600/80 hover:bg-green-700 text-white rounded-lg md:rounded-xl font-medium transition-all"
              >
                <Upload size={18} />
                <span>Küldés</span>
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'uploading' && (
          <motion.div
            key="uploading"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full flex flex-col items-center gap-4"
          >
            <div className="w-full">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-white md:text-black text-sm font-medium">
                  Feltöltés
                </span>
                <span className="text-white/70 md:text-black/70 text-sm">
                  {uploadProgress}%
                </span>
              </div>
              <div className="w-full h-2 bg-white/20 md:bg-gray-300 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          </motion.div>
        )}

        {phase === 'uploaded' && (
          <motion.div
            key="uploaded"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <p className="text-green-400 text-lg font-medium">Sikeres feltöltés! ✓</p>
          </motion.div>
        )}

        {phase === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full flex flex-col items-center gap-4"
          >
            <div className="text-center p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
              <p className="text-white md:text-black text-sm">{errorMessage}</p>
            </div>
            <div className="flex gap-2 w-full">
              {phase === 'error' && recordedBlobRef.current && (
                <>
                  <button
                    onClick={recordAgain}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-white/20 md:bg-gray-50 hover:bg-white/30 md:hover:bg-gray-100 border border-white/30 md:border-gray-200 text-white md:text-black rounded-lg font-medium transition-all"
                  >
                    <RotateCcw size={18} />
                    <span>Újra</span>
                  </button>
                  <button
                    onClick={retryUpload}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-orange-500/80 hover:bg-orange-600 text-white rounded-lg font-medium transition-all"
                  >
                    <Upload size={18} />
                    <span>Újrapróbálás</span>
                  </button>
                </>
              )}
              {(!recordedBlobRef.current || phase === 'error') && (
                <button
                  onClick={requestPermission}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-500/80 hover:bg-blue-600 text-white rounded-lg font-medium transition-all"
                >
                  <Video size={18} />
                  <span>Új rögzítés</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
