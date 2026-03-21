// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChainOfThought, type ChainPart } from "./chain-of-thought";

describe("ChainOfThought image steps", () => {
	it("treats image-file tools as reads instead of image generation", () => {
		const parts: ChainPart[] = [
			{
				kind: "tool",
				toolName: "image",
				toolCallId: "tool-1",
				status: "done",
				args: { path: "/tmp/photo.png" },
			},
		];

		render(<ChainOfThought parts={parts} isStreaming />);

		expect(screen.getByText("Read 1 image")).toBeTruthy();
		expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy();
		expect(screen.queryByText(/Generating image/i)).toBeNull();
	});

	it("keeps generation labels for prompt-based image tools", () => {
		const parts: ChainPart[] = [
			{
				kind: "tool",
				toolName: "image",
				toolCallId: "tool-1",
				status: "running",
				args: { description: "a cat wearing sunglasses" },
			},
		];

		render(<ChainOfThought parts={parts} isStreaming />);

		expect(
			screen.getByText("Generating image: a cat wearing sunglasses"),
		).toBeTruthy();
	});
});
