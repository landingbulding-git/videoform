import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { loadYouTubeIframeApi } from '../lib/youtubeApiLoader';

export type YouTubePlayerHandle = {
  play: () => void;
  pause: () => void;
  restartWithSound: () => void;
};

type YouTubeStepPlayerProps = {
  videoId: string;
  muted: boolean;
  onLoaded: () => void;
  onEnded: () => void;
  onPlayStateChange: (isPlaying: boolean) => void;
  playbackKey: string;
};

// background-size:cover math for a 16:9 iframe inside an arbitrary container
function computeCoverSize(containerW: number, containerH: number) {
  const sourceAspect = 16 / 9;
  const containerAspect = containerW / containerH;

  if (containerAspect > sourceAspect) {
    return { width: containerW, height: containerW / sourceAspect };
  }
  return { width: containerH * sourceAspect, height: containerH };
}

function applyCoverStyle(iframe: HTMLElement, containerW: number, containerH: number) {
  const { width, height } = computeCoverSize(containerW, containerH);
  Object.assign(iframe.style, {
    width: `${width}px`,
    height: `${height}px`,
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: 'none',
  });
}

const YouTubeStepPlayer = forwardRef<YouTubePlayerHandle, YouTubeStepPlayerProps>(
  ({ videoId, muted, onLoaded, onEnded, onPlayStateChange, playbackKey }, ref) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const loadedRef = useRef(false);
    // Capture initial mute state only — unmuting is handled via restartWithSound(),
    // and depending on `muted` here would destroy/recreate the player mid-playback.
    const initialMutedRef = useRef(muted);

    // Keep latest callbacks without re-running the init effect
    const callbacksRef = useRef({ onLoaded, onEnded, onPlayStateChange });
    callbacksRef.current = { onLoaded, onEnded, onPlayStateChange };

    useEffect(() => {
      let isMounted = true;
      const host = hostRef.current;
      if (!host) return;

      loadedRef.current = false;

      const initPlayer = async () => {
        console.log('[YouTubeStepPlayer] Loading YouTube API for videoId:', videoId);
        const YT = await loadYouTubeIframeApi();

        if (!isMounted || !hostRef.current) {
          console.warn('[YouTubeStepPlayer] Unmounted before init, skipping');
          return;
        }

        // YT.Player REPLACES the element we give it with an iframe.
        // Hand it an imperatively-created inner div so React's own DOM
        // (the host) is never mutated — otherwise React crashes with
        // "insertBefore on Node" on the next step transition.
        const inner = document.createElement('div');
        host.appendChild(inner);

        const rect = host.getBoundingClientRect();
        const { width, height } = computeCoverSize(rect.width, rect.height);

        console.log('[YouTubeStepPlayer] Creating YT.Player with videoId:', videoId);
        playerRef.current = new YT.Player(inner, {
          videoId,
          width: Math.floor(width),
          height: Math.floor(height),
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            mute: initialMutedRef.current ? 1 : 0,
            iv_load_policy: 3,
          },
          events: {
            onReady: (event: any) => {
              const iframe = event.target.getIframe();
              const r = host.getBoundingClientRect();
              applyCoverStyle(iframe, r.width, r.height);
            },
            onStateChange: (event: any) => {
              const YTGlobal = (window as any).YT;
              const state = event.data;
              if (state === YTGlobal.PlayerState.PLAYING) {
                if (!loadedRef.current) {
                  loadedRef.current = true;
                  callbacksRef.current.onLoaded();
                }
                callbacksRef.current.onPlayStateChange(true);
              } else if (state === YTGlobal.PlayerState.PAUSED) {
                callbacksRef.current.onPlayStateChange(false);
              } else if (state === YTGlobal.PlayerState.ENDED) {
                callbacksRef.current.onEnded();
              }
            },
          },
        });
      };

      initPlayer();

      // Keep the iframe cover-cropped as the container resizes
      const observer = new ResizeObserver(() => {
        const iframe = playerRef.current?.getIframe?.();
        if (iframe && hostRef.current) {
          const r = hostRef.current.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) applyCoverStyle(iframe, r.width, r.height);
        }
      });
      observer.observe(host);

      return () => {
        isMounted = false;
        observer.disconnect();
        if (playerRef.current?.destroy) {
          try {
            playerRef.current.destroy();
          } catch (e) {
            console.warn('[YouTubeStepPlayer] Error destroying player:', e);
          }
        }
        playerRef.current = null;
        // Remove whatever YT left behind — these children are ours, not React's
        host.replaceChildren();
      };
    }, [videoId, playbackKey]);

    useImperativeHandle(
      ref,
      () => ({
        play: () => playerRef.current?.playVideo?.(),
        pause: () => playerRef.current?.pauseVideo?.(),
        restartWithSound: () => {
          if (playerRef.current) {
            playerRef.current.unMute();
            playerRef.current.seekTo(0);
            playerRef.current.playVideo();
          }
        },
      }),
      []
    );

    return (
      <div
        ref={hostRef}
        className="absolute inset-0 w-full h-full bg-black overflow-hidden"
      />
    );
  }
);

YouTubeStepPlayer.displayName = 'YouTubeStepPlayer';

export default YouTubeStepPlayer;
