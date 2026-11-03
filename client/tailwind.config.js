/** Tailwind is used only by the landing page. Preflight (the global reset) is off so the rest of the app,
 *  which has its own hand-written CSS, is untouched. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/pages/LithosLanding.tsx'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
