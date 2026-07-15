import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
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

const YouTubeStepPlayer = forwardRef<YouTubePlayerHandle, YouTubeStepPlayerProps>(
  (
    {
      videoId,
      muted,
      onLoaded,
      onEnded,
      onPlayStateChange,
      playbackKey,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const loadedRef = useRef(false);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    // Compute cover-crop dimensions
    const computeCoverStyle = (containerW: number, containerH: number) => {
      const sourceAspect = 16 / 9;
      const containerAspect = containerW / containerH;

      let width: number, height: number;

      if (containerAspect > sourceAspect) {
        // Container wider than 16:9 → scale by width, overshoot height
        width = containerW;
        height = containerW / sourceAspect;
      } else {
        // Container narrower than 16:9 → scale by height, overshoot width
        height = containerH;
        width = containerH * sourceAspect;
      }

      return {
        width: `${width}px`,
        height: `${height}px`,
        position: 'absolute' as const,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    };

    // Setup ResizeObserver to recompute iframe size on container resize
    useEffect(() => {
      if (!containerRef.current || !playerRef.current) return;

      const updateSize = () => {
        const rect = containerRef.current!.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && playerRef.current) {
          const style = computeCoverStyle(rect.width, rect.height);
          Object.assign(playerRef.current.getIframe().style, style);
        }
      };

      resizeObserverRef.current = new ResizeObserver(updateSize);
      resizeObserverRef.current.observe(containerRef.current);

      // Initial size
      updateSize();

      return () => {
        resizeObserverRef.current?.disconnect();
      };
    }, []);

    // Initialize YouTube player
    useEffect(() => {
      const initPlayer = async () => {
        console.log('[YouTubeStepPlayer] Loading YouTube API for videoId:', videoId);
        const YT = await loadYouTubeIframeApi();
        console.log('[YouTubeStepPlayer] YouTube API loaded, YT:', YT);

        if (!containerRef.current) {
          console.warn('[YouTubeStepPlayer] Container ref not found');
          return;
        }

        const rect = containerRef.current.getBoundingClientRect();
        const style = computeCoverStyle(rect.width, rect.height);

        console.log('[YouTubeStepPlayer] Creating YT.Player with videoId:', videoId, 'size:', style.width, style.height);
        playerRef.current = new YT.Player(containerRef.current, {
          videoId,
          width: Math.floor(style.width.replace('px', '') as any),
          height: Math.floor(style.height.replace('px', '') as any),
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            mute: muted ? 1 : 0,
            iv_load_policy: 3,
          },
          events: {
            onStateChange: handleStateChange,
          },
        });
      };

      initPlayer();

      return () => {
        if (playerRef.current?.destroy) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
      };
    }, [videoId, playbackKey, muted]);

    const handleStateChange = (event: any) => {
      const YT = (window as any).YT;
      const state = event.data;

      // UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5
      if (state === YT.PlayerState.PLAYING) {
        if (!loadedRef.current) {
          loadedRef.current = true;
          onLoaded();
        }
        onPlayStateChange(true);
      } else if (state === YT.PlayerState.PAUSED) {
        onPlayStateChange(false);
      } else if (state === YT.PlayerState.ENDED) {
        onEnded();
      }
    };

    // Expose imperative controls via forwardRef
    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          if (playerRef.current?.playVideo) {
            playerRef.current.playVideo();
          }
        },
        pause: () => {
          if (playerRef.current?.pauseVideo) {
            playerRef.current.pauseVideo();
          }
        },
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
        ref={containerRef}
        className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden cursor-pointer"
      >
        {/* YouTube Player injected here by the iframe_api */}
      </div>
    );
  }
);

YouTubeStepPlayer.displayName = 'YouTubeStepPlayer';

export default YouTubeStepPlayer;
