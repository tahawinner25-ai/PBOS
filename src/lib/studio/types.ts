/** Shapes shared by the Studio's page and components. */

/** A video already in the creator's library, as the Studio page lists it. */
export type LibraryVideo = { id: string; label: string | null; bytes: number | null; duration: number | null; width: number | null; height: number | null };

/** A video loaded into the editor. `url` is a blob: URL that lives only in this browser tab. */
export type SourceMeta = { url: string; label: string; duration: number; width: number; height: number; origin: 'library' | 'local' };

/** Local files are decoded in the browser, so they are capped to keep the tab responsive. */
export const LOCAL_FILE_MAX_BYTES = 300 * 1024 * 1024;
