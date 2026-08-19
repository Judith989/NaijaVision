// GitHub Pages uses a repository sub-path. Vercel serves the app at the domain
// root. Raw fetch and model asset paths need the same build-time distinction.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
