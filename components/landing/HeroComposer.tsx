"use client";

import { useState } from "react";
import { ArrowUp, ImagePlus, Sparkles } from "lucide-react";
import { templateExamplePrompts } from "@/lib/cad/templates";

const examples = templateExamplePrompts(6);

export function HeroComposer({ initialPrompt, onGenerate }: { initialPrompt?: string; onGenerate: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState(initialPrompt || examples[0]);

  return (
    <main className="landing">
      <nav className="landing-nav">
        <div className="brand">
          <Sparkles size={18} />
          <span>Build123d CAD Agent</span>
        </div>
        <a href="https://github.com/yzlin286-wq/bilnd123-cad-agent-workspace">GitHub</a>
      </nav>
      <section className="hero-panel">
        <div className="hero-kicker">AI CAD workspace</div>
        <h1>Build CAD with natural language</h1>
        <p>
          Describe your part. The agent prepares editable build123d code, validates the geometry,
          and exports production-ready STEP files.
        </p>
        <div className="hero-composer">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe a part..."
          />
          <div className="composer-row">
            <button className="soft-action" type="button" disabled title="Coming soon">
              <ImagePlus size={16} />
              Upload sketch: Coming soon
            </button>
            <button className="generate-button" onClick={() => onGenerate(prompt.trim())} disabled={!prompt.trim()}>
              Generate
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
        <div className="prompt-chips">
          {examples.map((example) => (
            <button key={example} onClick={() => setPrompt(example)}>
              {example}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
