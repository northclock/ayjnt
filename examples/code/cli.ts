import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
} from "@opentui/core";
import type { AyjntCli } from "@ayjnt/cli";

export default async function ({ agents, argv }: AyjntCli) {
  const sessionId =
    argv[0] ??
    new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, 19);
  const agent = agents.ayjntCode(sessionId);
  const renderer = await createCliRenderer({ exitOnCtrlC: true });

  const frame = new BoxRenderable(renderer, {
    id: "frame",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    borderStyle: "rounded",
    borderColor: "#315fbd",
    padding: 1,
    gap: 1,
  });
  const header = new TextRenderable(renderer, {
    id: "header",
    content: ` ayjnt-code  ${sessionId}  ·  browser /ayjnt-code/${sessionId}`,
    fg: "#7be0bd",
  });
  const transcript = new BoxRenderable(renderer, {
    id: "transcript",
    flexGrow: 1,
    flexDirection: "column",
    gap: 1,
  });
  const status = new TextRenderable(renderer, {
    id: "status",
    content: "Ready",
    fg: "#8993a5",
  });
  const input = new InputRenderable(renderer, {
    id: "prompt",
    width: "100%",
    placeholder: "Describe a coding task…",
    backgroundColor: "#202b41",
    focusedBackgroundColor: "#263650",
    textColor: "#ffffff",
    cursorColor: "#ff9254",
  });

  frame.add(header);
  frame.add(transcript);
  frame.add(status);
  frame.add(input);
  renderer.root.add(frame);
  input.focus();

  let busy = false;
  input.on(InputRenderableEvents.ENTER, async (value: string) => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    busy = true;
    input.value = "";
    transcript.add(
      new TextRenderable(renderer, {
        id: crypto.randomUUID(),
        content: `you  ${prompt}`,
        fg: "#ffb07f",
      }),
    );
    status.content = "Agent is working…";
    const response = await agent.run(prompt);
    transcript.add(
      new TextRenderable(renderer, {
        id: crypto.randomUUID(),
        content: `agent  ${response}`,
        fg: "#dce4f2",
      }),
    );
    status.content = "Ready";
    busy = false;
    input.focus();
  });

  await new Promise<void>((resolve) => {
    renderer.keyInput.on("keypress", (key) => {
      if (key.ctrl && key.name === "c") resolve();
    });
  });
  renderer.destroy();
}
