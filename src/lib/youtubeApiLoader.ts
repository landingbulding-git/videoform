declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<typeof window.YT> | null = null;

export function loadYouTubeIframeApi(): Promise<typeof window.YT> {
  if (ytApiPromise) {
    console.log('[youtubeApiLoader] Returning cached YT API promise');
    return ytApiPromise;
  }

  console.log('[youtubeApiLoader] Loading YouTube IFrame API...');
  ytApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      console.log('[youtubeApiLoader] YT.Player already available');
      resolve(window.YT);
      return;
    }

    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      console.log('[youtubeApiLoader] onYouTubeIframeAPIReady fired');
      prevCallback?.();
      resolve(window.YT);
    };

    console.log('[youtubeApiLoader] Injecting iframe_api script');
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => console.error('[youtubeApiLoader] Failed to load iframe_api script');
    document.head.appendChild(script);
  });

  return ytApiPromise;
}
