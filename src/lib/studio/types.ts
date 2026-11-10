/** Shapes shared by the Studio's page and components. */

/** A video already in the creator's library, as the Studio page lists it. */
export type LibraryVideo = { id: string; label: string | null; bytes: number | null; duration: number | null; width: number | null; height: number | null };

/** An edit the agent planned, resolved against the creator's library on the server. */
export type StudioPlan = {
  aspect: '9:16' | '1:1' | '16:9';
  fit: 'cover' | 'contain';
  clips: Array<{ video: LibraryVideo; start: number; end: number; volume: number }>;
  texts: Array<{ text: string; start: number; end: number; position: 'top' | 'middle' | 'bottom'; size: 'small' | 'medium' | 'large'; color: 'white' | 'yellow' | 'black'; box: boolean }>;
  /** Clips left out because their video is no longer in the library. */
  skipped: number;
};

/** A video loaded into the editor. `url` is a blob: URL that lives only in this browser tab. */
export type SourceMeta = { url: string; label: string; duration: number; width: number; height: number; origin: 'library' | 'local' };

/** Local files are decoded in the browser, so they are capped to keep the tab responsive. */
export const LOCAL_FILE_MAX_BYTES = 300 * 1024 * 1024;
