import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "ayjnt — Agent-first framework for Cloudflare",
	description:
		"File-based routing, auto-generated wrangler config, typed inter-agent RPC, co-located React UIs, and MCP support. No worker boilerplate, no wrangler wrestling.",
	openGraph: {
		title: "ayjnt — Agent-first framework for Cloudflare",
		description:
			"File-based routing for Cloudflare Agents. Write the agent, the framework writes everything else.",
		type: "website",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
			</head>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased relative`}
			>
				<Nav />
				<main className="relative">{children}</main>
				<Footer />
			</body>
		</html>
	);
}
