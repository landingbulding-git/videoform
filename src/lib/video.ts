export type VideoSource =
  | { type: 'youtube'; videoId: string }
  | { type: 'file'; url: string };

const YOUTUBE_HOST_RE = /(?:youtube\.com|youtu\.be)/i;
const BARE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function parseVideoSource(videoUrl: string): VideoSource {
  const trimmed = videoUrl.trim();

  // Check if it's a bare 11-character YouTube ID
  if (BARE_ID_RE.test(trimmed)) {
    return { type: 'youtube', videoId: trimmed };
  }

  // Check if it's a YouTube URL
  if (YOUTUBE_HOST_RE.test(trimmed)) {
    try {
      const u = new URL(trimmed);

      // Handle youtu.be short links
      if (u.hostname.includes('youtu.be')) {
        const id = u.pathname.slice(1).split('/')[0];
        if (BARE_ID_RE.test(id)) {
          return { type: 'youtube', videoId: id };
        }
      } else {
        // Handle youtube.com/watch?v=ID
        const vParam = u.searchParams.get('v');
        if (vParam && BARE_ID_RE.test(vParam)) {
          return { type: 'youtube', videoId: vParam };
        }

        // Handle youtube.com/embed/ID
        const embedMatch = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
        if (embedMatch) {
          return { type: 'youtube', videoId: embedMatch[1] };
        }
      }
    } catch {
      // Fall through to file
    }
  }

  // Default to file source (mp4, m3u8, etc.)
  return { type: 'file', url: trimmed };
}
