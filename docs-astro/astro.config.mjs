// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
	// Production origin. Used to build ABSOLUTE og:image / canonical URLs at
	// build time (social scrapers like Slack/Discord/Twitter reject relative
	// image URLs). TODO: confirm the real production domain.
	site: "https://ayjnt.dev",
	output: "static",
	integrations: [react()],
	vite: {
		plugins: [tailwindcss()],
	},
});
