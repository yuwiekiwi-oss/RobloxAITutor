import { type ReactNode, useEffect, useRef, useState } from "react";
import { CodeEditor, Highlighted } from "../../../components/Code";
import { Icon } from "../../../components/Icon";
import { Loader } from "../../../components/Loader";
import { TutorAvatar } from "../../../components/TutorAvatar";
import { useApi } from "../../../lib/api";
import { imagesFromDataTransfer, isAcceptedImage, prepareScreenshot } from "../../../lib/image";
import { BLANK_TOKEN, type ChoiceQuestion, type CodeLine, type CodeQuiz, type ConceptEventRow, type ConceptRow, LIMITS, type ProjectBlockRow, type ProjectPlan, type ProjectWithBlocks } from "../../../lib/types";
import { TreePaste } from "../TreePaste";
import { GateQuestion } from "./GateQuestion";
import { CodeWithBlank, CopyButton, SegmentedCode } from "./ProjectCode";
import { assembledCode, LEVEL_NAMES, MODE_LABEL, STAGES } from "./stages";
import { checkTyped, needsTyping } from "./typing";
import "./project.css";

type Props = {
  pw: ProjectWithBlocks;
  onChange: (pw: ProjectWithBlocks | null) => void;
  /** Open the chat with a question (and the student's code, when there is some). */
  onAskTutor: (question: string, code?: string) => void;
  /** A change asked for in the chat is being applied (re-plan / re-build). */
  revising?: boolean;
};

/** Steps this project actually has (いじる / 予想する only on older projects). */
function stepsOf(project: ProjectWithBlocks["project"]) {
  return STAGES.filter((s) => s.id !== "tweak" || project.tweak).flatMap((s) =>
    s.id === "run" && project.predict ? [{ id: "predict" as const, label: "予想する" }, s] : [s]
  );
}

function Stepper({ project }: { project: ProjectWithBlocks["project"] }) {
  const steps = stepsOf(project);
  const current = steps.findIndex((s) => s.id === project.stage);
  return (
    <ol className="stepper" aria-label="作品の進み具合">
      {steps.map((s, i) => (
        <li key={s.id} className={i < current ? "is-done" : i === current ? "is-current" : ""} aria-current={i === current ? "step" : undefined}>
          <span className="step-dot">{i < current ? <Icon name="check" size={12} /> : i + 1}</span>
          <span className="step-name">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Speech({ children }: { children: ReactNode }) {
  return (
    <div className="pw-speech">
      <TutorAvatar size={44} />
      <div className="pw-bubble glass">{children}</div>
    </div>
  );
}

export function ProjectWorkspace({ pw, onChange, onAskTutor, revising }: Props) {
  const api = useApi();
  const { project, blocks } = pw;
  const reload = async () => onChange(await api.getProject(project.id));

  return (
    <div className="pw">
      <header className="pw-head">
        <div>
          <p className="eyebrow">MY PROJECT</p>
          <h2 className="pw-title">{project.title ?? project.idea}</h2>
        </div>
        {["plan", "build"].includes(project.stage) && !revising && (
          <button
            className="link-btn"
            onClick={async () => {
              if (!window.confirm("この作品をやめて、別のものを作る？")) return;
              await api.abandonProject(project.id);
              onChange(null);
            }}
          >
            この作品をやめる
          </button>
        )}
      </header>
      <Stepper project={project} />

      <div className="pw-stage" key={revising ? "revising" : project.stage}>
        {revising ? (
          <div className="pw-busy glass">
            <Loader label="AI先生が作り直し中" />
            <p>AI先生が作品を作り直しているよ…</p>
            <p className="muted">10〜20秒くらいかかることがあるよ</p>
          </div>
        ) : <>
        {project.stage === "plan" && <PlanStep pw={pw} onChange={onChange} />}
        {project.stage === "build" && <BuildStep pw={pw} reload={reload} onAskTutor={onAskTutor} />}
        {project.stage === "predict" && project.predict && (
          <>
            <Speech>
              <p>コードがそろったね！ <b>Studioで動かす前に、何が起きるか予想</b>してみよう。</p>
            </Speech>
            <SegmentedCode blocks={blocks} />
            <GateQuestion
              label="予想する"
              question={project.predict.question}
              choices={project.predict.choices}
              onAnswer={(c) => api.answerGate(project.id, "predict", c)}
              onContinue={reload}
              continueLabel="Studioで動かす"
            />
          </>
        )}
        {project.stage === "run" && <RunStep pw={pw} reload={reload} onAskTutor={onAskTutor} />}
        {project.stage === "explore" && <ExploreStep pw={pw} reload={reload} />}
        {project.stage === "tweak" && project.tweak && <TweakStep pw={pw} reload={reload} />}
        {project.stage === "done" && <DoneStep pw={pw} onNew={() => onChange(null)} />}
        </>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ plan
// 1) AI先生 asks up to 3 tap-to-answer questions  2) 「こういうこと？」→ そう！ / ちょっとちがう
function PlanStep({ pw, onChange }: { pw: ProjectWithBlocks; onChange: Props["onChange"] }) {
  const api = useApi();
  const { project } = pw;
  const plan = project.plan as ProjectPlan;
  const questions = plan.questions ?? [];
  const [busy, setBusy] = useState<null | "think" | "build">(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [fixing, setFixing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [tree, setTree] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [scriptSrc, setScriptSrc] = useState("");
  const [idea, setIdea] = useState(project.idea);

  const run = async (kind: "think" | "build", fn: () => Promise<ProjectWithBlocks>) => {
    setBusy(kind);
    setError(null);
    try {
      const next = await fn();
      setFixing(false);
      setEditing(false);
      setFeedback("");
      setTree(null);
      setPicked({});
      setScriptSrc("");
      onChange(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (busy) {
    return (
      <div className="pw-busy glass">
        <Loader label="AI先生が考え中" />
        <p>{busy === "build" ? "AI先生がコードを作っているよ…" : "AI先生が考えなおしているよ…"}</p>
        <p className="muted">10秒くらいかかることがあるよ</p>
      </div>
    );
  }

  const seen = [
    project.idea_images?.length ? `画像 ${project.idea_images.length}枚` : null,
    project.explorer_tree ? "Studioの構成" : null,
  ].filter(Boolean);

  // ---- questions first
  if (questions.length > 0) {
    const allAnswered = questions.every((_, i) => picked[i]);
    return (
      <>
        <Speech>
          <p>作る前に、{questions.length === 1 ? "1つ" : `${questions.length}つ`}だけ教えて！</p>
          <p className="muted">えらぶだけでOK。わからなければ「おまかせ」でいいよ。</p>
        </Speech>
        <div className="plan-questions">
          {questions.map((q, i) => (
            <section key={q.question} className="plan-q glass">
              <p className="plan-q-text"><span className="latin">Q{i + 1}</span>{q.question}</p>
              <div className="plan-q-choices" role="radiogroup" aria-label={q.question}>
                {[...q.choices, "おまかせ"].map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={picked[i] === c}
                    className={`plan-chip ${picked[i] === c ? "is-on" : ""} ${c === "おまかせ" ? "is-auto" : ""}`}
                    onClick={() => setPicked((p) => ({ ...p, [i]: c }))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="pw-actions">
          <button
            className="btn btn-primary btn-lg"
            disabled={!allAnswered}
            onClick={() => run("think", () => api.refinePlan(project.id, {
              answers: questions.map((q, i) => ({ question: q.question, answer: picked[i] })),
            }))}
          >
            答えた！ <Icon name="send" />
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </>
    );
  }

  // ---- AI先生 wants to see a script the student already has (to insert the code into it)
  if (plan.script_request) {
    const req = plan.script_request;
    return (
      <>
        <Speech>
          <p>「<b>{req.name}</b>」の中身を見せて！</p>
          {req.reason && <p className="muted">{req.reason}</p>}
        </Speech>
        <div className="pw-idea glass">
          <p className="plan-fix-label">Studioでそのスクリプトを開いて、<kbd>Ctrl</kbd>+<kbd>A</kbd> → <kbd>Ctrl</kbd>+<kbd>C</kbd> でコピーして、ここに貼ってね</p>
          <CodeEditor value={scriptSrc} onChange={setScriptSrc} placeholder="-- ここに貼る" />
          <div className="pw-actions">
            <button
              className="btn btn-primary"
              disabled={!scriptSrc.trim()}
              onClick={() => run("think", () => api.refinePlan(project.id, { script: { path: req.name, source: scriptSrc } }))}
            >
              貼った！ <Icon name="send" size={16} />
            </button>
            <button className="btn btn-ghost" onClick={() => run("think", () => api.refinePlan(project.id, { noScript: true }))}>
              そのスクリプトはない
            </button>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
      </>
    );
  }

  // ---- 「こういうこと？」
  return (
    <>
      <Speech>
        <p className="plan-confirm-label">こういうこと？</p>
        <p className="pw-plan-summary">{plan.understanding || plan.summary}</p>
        {seen.length > 0 && <p className="plan-seen"><Icon name="eye" size={14} /> {seen.join("・")}も見たよ</p>}
        {plan.question && <p className="pw-plan-question">{plan.question}</p>}
      </Speech>
      {plan.parts && plan.parts.length > 0 && (
        <ol className="pw-parts glass">
          {plan.parts.map((p, i) => (
            <li key={i}><span className="latin">{i + 1}</span>{p}</li>
          ))}
        </ol>
      )}

      {editing ? (
        <div className="pw-idea glass">
          <p className="plan-fix-label">作りたいものを書き直す</p>
          <textarea className="input pw-idea-input" value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={300} rows={2} />
          <div className="pw-actions">
            <button
              className="btn btn-primary"
              disabled={!idea.trim()}
              onClick={() => run("think", () => api.planProject(project.session_id, idea, {
                images: project.idea_images ?? [],
                tree: project.explorer_tree,
              }))}
            >
              もう一度考えてもらう
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>もどる</button>
          </div>
        </div>
      ) : fixing ? (
        <div className="pw-idea glass">
          <p className="plan-fix-label">どこがちがう？</p>
          <textarea
            className="input pw-idea-input"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="どこを変えたい？"
          />
          {!project.explorer_tree && <TreePaste value={tree} onChange={setTree} />}
          <div className="pw-actions">
            <button
              className="btn btn-primary"
              disabled={!feedback.trim() && !tree}
              onClick={() => run("think", () => api.refinePlan(project.id, { feedback, tree }))}
            >
              これで考えなおして
            </button>
            <button className="btn btn-ghost" onClick={() => setFixing(false)}>もどる</button>
            <button className="link-btn" onClick={() => { setFixing(false); setEditing(true); }}>はじめから書き直す</button>
          </div>
        </div>
      ) : (
        <div className="pw-actions">
          <button className="btn btn-primary btn-lg" onClick={() => run("build", () => api.buildProject(project.id))}>
            そう！これで作る <Icon name="send" />
          </button>
          <button className="btn btn-ghost" onClick={() => setFixing(true)}>ちょっとちがう</button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

// ------------------------------------------------------------------ build (type it by hand)
// Blocks are done in order. Explained / mastered blocks (and blanks once filled) are typed line by
// line while reading each line's translation; the code cannot be copied. "Write" blocks are written
// from scratch and checked by AI先生.
function BuildStep({ pw, reload, onAskTutor }: { pw: ProjectWithBlocks; reload: () => Promise<void>; onAskTutor: Props["onAskTutor"] }) {
  const current = pw.blocks.find((b) => !b.build_done);
  const lineCount = pw.blocks.reduce((n, b) => n + (b.lines?.length ?? (b.code ?? "").split("\n").filter((l) => l.trim()).length), 0);
  return (
    <>
      <Speech>
        <p>
          AI先生がコードを作ったよ！ 説明を読みながら、<b>1行ずつ自分の手で打ちこもう</b>。
        </p>
        <p className="muted">ぜんぶで{lineCount}行くらい。打ったコードがそのまま自分の作品になるよ。</p>
      </Speech>
      <div className="blocks">
        {pw.blocks.map((b) =>
          b.build_done ? <DoneBlock key={b.id} block={b} />
          : b === current ? <BlockCard key={b.id} projectId={pw.project.id} block={b} reload={reload} onAskTutor={onAskTutor} />
          : (
            <article key={b.id} className="block glass is-locked">
              <header className="block-head">
                <span className="block-no latin">{b.idx + 1}</span>
                <span className="block-title">{b.title}</span>
                <span className="block-mode">このあと</span>
              </header>
            </article>
          )
        )}
      </div>
    </>
  );
}

function DoneBlock({ block }: { block: ProjectBlockRow }) {
  return (
    <article className="block glass is-done">
      <header className="block-head">
        <span className="block-no latin">{block.idx + 1}</span>
        <span className="block-title">{block.title}</span>
        <span className="block-mode mode-done"><Icon name="check" size={13} /> できた！</span>
      </header>
      <CodeWithBlank code={block.code ?? ""} />
    </article>
  );
}

function BlockCard({ projectId, block, reload, onAskTutor }: {
  projectId: string;
  block: ProjectBlockRow;
  reload: () => Promise<void>;
  onAskTutor: Props["onAskTutor"];
}) {
  const api = useApi();
  const filling = block.mode === "blank" && (block.code ?? "").includes(BLANK_TOKEN);
  return (
    <article className={`block glass mode-${block.mode} is-active`}>
      <header className="block-head">
        <span className="block-no latin">{block.idx + 1}</span>
        <span className="block-title">{block.title}</span>
        <span className={`block-mode mode-${block.mode}`}>{filling ? MODE_LABEL.blank : block.mode === "write" ? MODE_LABEL.write : "打ちこむ"}</span>
      </header>

      {block.mode === "write" ? (
        <WriteTask projectId={projectId} block={block} reload={reload} onAskTutor={onAskTutor} />
      ) : filling && block.blank ? (
        <>
          <CodeWithBlank code={block.code ?? ""} />
          <GateQuestion
            label="穴うめ"
            question={block.blank.prompt}
            choices={block.blank.choices}
            onAnswer={(c) => api.answerGate(projectId, `blank:${block.idx}`, c)}
            onContinue={reload}
            continueLabel="打ちこみに進む"
          />
        </>
      ) : (
        <TypingBlock projectId={projectId} block={block} reload={reload} />
      )}
    </article>
  );
}

type TLine = { code: string; meaning: string | null; words: CodeLine["words"] };

/** The block's current code, line by line, with each line's translation (when there is one). */
const linesOf = (b: ProjectBlockRow): TLine[] => {
  const code = (b.code ?? "").split("\n").filter((l) => l.trim());
  const lines = b.lines ?? [];
  if (code.length === 0) return lines.map((l) => ({ code: l.code, meaning: l.meaning, words: l.words ?? [] }));
  // A filled blank keeps its (masked) translation: pair meanings with the real code lines by position.
  const paired = lines.length === code.length;
  return code.map((c, i) => ({ code: c, meaning: paired ? lines[i].meaning : null, words: paired ? lines[i].words ?? [] : [] }));
};

const stopCopy = (e: { preventDefault: () => void }) => e.preventDefault();

function TypingBlock({ projectId, block, reload }: { projectId: string; block: ProjectBlockRow; reload: () => Promise<void> }) {
  const api = useApi();
  const lines = linesOf(block);
  const firstToType = (from: number) => {
    let i = from;
    while (i < lines.length && !needsTyping(lines[i].code)) i++; // comment-only lines are just read
    return i;
  };
  const [pos, setPos] = useState(() => firstToType(0));
  const [typed, setTyped] = useState("");
  const [miss, setMiss] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = pos >= lines.length;

  useEffect(() => {
    if (!done || saving) return;
    setSaving(true);
    api.markBlockTyped(projectId, block.idx).then(reload).catch((e: Error) => {
      setNote(e.message);
      setSaving(false);
    });
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pos > 0 && !done) inputRef.current?.focus();
    document.querySelector(".type-line.is-current")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pos, done]);

  const next = () => {
    setTyped("");
    setMiss(null);
    setNote(null);
    setPos((p) => firstToType(p + 1));
  };
  const onType = (v: string) => {
    setTyped(v);
    setMiss(null);
    if (!done && checkTyped(v, lines[pos].code).ok) next();
  };
  const onEnter = () => {
    if (done) return;
    const r = checkTyped(typed, lines[pos].code);
    if (r.ok) next();
    else setMiss(r.matched);
  };

  return (
    <div className="typing">
      {(block.explanation || block.purpose) && (
        <p className="type-intro"><Icon name="bulb" size={16} /> {block.explanation ?? block.purpose}</p>
      )}
      <ol className="type-lines">
        {lines.slice(0, Math.min(pos + 1, lines.length)).map((l, i) => {
          const current = i === pos;
          const skipped = !needsTyping(l.code);
          return (
            <li key={i} className={`type-line ${current ? "is-current" : "is-done"}`}>
              {/* Same layout as the line-by-line explanation: the code, what it means, and its words. */}
              <div className="type-row-head">
                {!current && !skipped && <span className="type-check"><Icon name="check" size={13} /></span>}
                <pre
                  className={`type-model ${current ? "" : "is-small"}`}
                  onCopy={stopCopy}
                  onCut={stopCopy}
                  onContextMenu={stopCopy}
                  onDragStart={stopCopy}
                  aria-label={current ? "お手本（見て打ちこもう）" : undefined}
                >
                  <code><Highlighted code={l.code.replace(/^\s+/, "")} /></code>
                </pre>
              </div>
              <p className={current ? "type-meaning" : "type-meaning-done"}>
                {skipped ? "（メモの行だよ。打たなくてOK）" : l.meaning ?? (current ? "この行を打ちこもう" : "")}
              </p>
              {l.words.length > 0 && (
                <ul className={`lbl-words ${current ? "" : "is-small"}`}>
                  {l.words.map((w) => <li key={w.word}><code>{w.word}</code><span>{w.meaning}</span></li>)}
                </ul>
              )}
              {current && (
                <>
                  <input
                    ref={inputRef}
                    className="type-input"
                    value={typed}
                    onChange={(e) => onType(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        onEnter();
                      }
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      setNote("ここは自分の手で打ちこもう！");
                    }}
                    onDrop={stopCopy}
                    placeholder="ここに打ちこむ（スペースや字下げは気にしなくてOK）"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    aria-label={`${i + 1}行目を打ちこむ`}
                  />
                  {miss !== null && (
                    <p className="type-miss">
                      {miss ? <>「<code>{miss}</code>」までは合ってるよ。そのあとを、お手本とよく見くらべてね。</> : "さいしょから、お手本とちがうよ。よく見くらべてね。"}
                      大文字・小文字や記号（= と == など）にも気をつけよう。
                    </p>
                  )}
                  {note && <p className="type-miss">{note}</p>}
                  <p className="type-hint muted">合っていれば自動で次の行に進むよ。<kbd>Enter</kbd> でチェックもできる。</p>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {done && <p className="type-done"><Icon name="check" size={16} /> このまとまりは打ちこめた！</p>}
    </div>
  );
}

function WriteTask({ projectId, block, reload, onAskTutor }: {
  projectId: string;
  block: ProjectBlockRow;
  reload: () => Promise<void>;
  onAskTutor: Props["onAskTutor"];
}) {
  const api = useApi();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [done, setDone] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const r = await api.submitWrite(projectId, block.idx, code);
      setFeedback({ text: r.feedback, ok: r.passed });
      if (r.passed || r.revealed) setDone(true);
    } catch (e) {
      setFeedback({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="write-task">
      <p className="write-goal">
        <Icon name="bulb" size={16} /> ここは前に習ったところ。<b>{block.purpose}</b>コードを、自分で書いてみよう！
      </p>
      <CodeEditor value={code} onChange={setCode} placeholder="-- ここに書いてね" />
      {feedback && <p className={`check-feedback ${feedback.ok ? "ok" : "ng"}`}>{feedback.text}</p>}
      <div className="write-actions">
        {done ? (
          <button className="btn btn-primary" onClick={reload}>次へ <Icon name="send" size={16} /></button>
        ) : (
          <>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => onAskTutor(
                code.trim()
                  ? `「${block.purpose}」を自分で書いているところ。ここまで書いたけど、つづきがわからない。答えじゃなくてヒントがほしい。`
                  : `「${block.purpose}」を自分で書きたいけど、何から書けばいいかわからない。ヒントがほしい。`,
                code,
              )}
            >
              <Icon name="chat" size={16} /> ここまでをAI先生に聞く
            </button>
            <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={check}>
              {busy ? "チェック中…" : "AI先生にチェックしてもらう"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ run
function RunStep({ pw, reload, onAskTutor }: { pw: ProjectWithBlocks; reload: () => Promise<void>; onAskTutor: Props["onAskTutor"] }) {
  const api = useApi();
  const { project, blocks } = pw;
  const placement = project.placement as { script_type?: string; parent_path?: string; steps?: string[] };
  const [busy, setBusy] = useState(false);
  const report = async (ok: boolean) => {
    setBusy(true);
    try {
      await api.reportRun(project.id, ok);
      if (ok) await reload();
      else onAskTutor("作品が動かない。どこを確かめればいい？");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Speech>
        <p><b>Roblox Studioで動かしてみよう！</b> 下の順番でやってね。</p>
      </Speech>
      <section className="run-place glass">
        <p className="run-label">置く場所</p>
        <p className="run-path">
          {(placement.parent_path ?? "Workspace").split(".").map((seg, i) => (
            <span key={i} className="path-seg">{seg}</span>
          ))}
          <span className="path-seg is-script">{placement.script_type ?? "Script"}</span>
        </p>
        <ol className="run-steps">
          {(placement.steps ?? []).map((s, i) => <li key={i}><span className="latin">{i + 1}</span>{s}</li>)}
        </ol>
      </section>
      <p className="muted run-copy-note">打ちこんだコードはこれだよ。Studioに貼るときだけコピーできるよ。</p>
      <SegmentedCode blocks={blocks} />
      <div className="pw-actions">
        <CopyButton text={assembledCode(blocks)} label="打ちこんだコードをコピー" />
      </div>
      <div className="run-report">
        <p>Studioで ▶ プレイ を押して試してみた？</p>
        <div className="pw-actions">
          <button className="btn btn-primary btn-lg run-ok" disabled={busy} onClick={() => report(true)}>
            <Icon name="check" /> 動いた！
          </button>
          <button className="btn btn-lg" disabled={busy} onClick={() => report(false)}>
            <Icon name="question" /> 動かない…
          </button>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ explore (test)
// 「こうしたい！どう変える？」: a piece of the student's code to change so the game does something else.
function CodeTest({ pw, quiz, reload }: { pw: ProjectWithBlocks; quiz: CodeQuiz[]; reload: () => Promise<void> }) {
  const api = useApi();
  const [i, setI] = useState(0);
  const [code, setCode] = useState(quiz[0].code);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean; answer: string | null; done: boolean } | null>(null);
  const last = i === quiz.length - 1;
  const q = quiz[i];

  const check = async () => {
    setBusy(true);
    try {
      const r = await api.answerQuiz(pw.project.id, i, code);
      setResult({ text: r.feedback, ok: r.passed, answer: r.revealed ? r.answer : null, done: r.passed || r.revealed });
    } catch (e) {
      setResult({ text: (e as Error).message, ok: false, answer: null, done: false });
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    if (last) return reload();
    setI(i + 1);
    setCode(quiz[i + 1].code);
    setResult(null);
  };

  return (
    <>
      <Speech>
        <p className="explore-title">コードのテスト</p>
        <p>打ちこんだコードを、ちょっとだけ書きかえよう。ぜんぶで<b>{quiz.length}問</b>だよ。</p>
        <p className="explore-count">{i + 1} / {quiz.length} 問目</p>
      </Speech>
      <section className="code-test glass" key={i}>
        <p className="code-test-goal"><span className="latin">Q{i + 1}</span>{q.goal}</p>
        <p className="muted code-test-lead">下のコードを、どう変えればいい？ 書きかえてチェックしよう。</p>
        <CodeEditor value={code} onChange={setCode} />
        {result && <p className={`check-feedback ${result.ok ? "ok" : "ng"}`}>{result.text}</p>}
        {result?.answer && (
          <div className="code-test-answer">
            <p className="run-label">お手本</p>
            <CodeWithBlank code={result.answer} />
          </div>
        )}
        <div className="pw-actions">
          {result?.done ? (
            <button className="btn btn-primary" onClick={next}>
              {last ? "テストおわり！" : "次の問題へ"} <Icon name="send" size={16} />
            </button>
          ) : (
            <>
              <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={check}>
                {busy ? "チェック中…" : "AI先生にチェックしてもらう"}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => { setCode(q.code); setResult(null); }}>
                元にもどす
              </button>
            </>
          )}
        </div>
      </section>
    </>
  );
}

function TestStep({ pw, quiz, reload }: { pw: ProjectWithBlocks; quiz: ChoiceQuestion[]; reload: () => Promise<void> }) {
  const api = useApi();
  const [i, setI] = useState(0);
  const last = i === quiz.length - 1;
  return (
    <>
      <Speech>
        <p className="explore-title">テスト</p>
        <p>打ちこんだコードを思い出して答えよう。ぜんぶで<b>{quiz.length}問</b>だよ。</p>
        <p className="explore-count">{i + 1} / {quiz.length} 問目</p>
      </Speech>
      <SegmentedCode blocks={pw.blocks} />
      <GateQuestion
        key={i}
        label={`テスト ${i + 1}`}
        question={quiz[i].question}
        choices={quiz[i].choices}
        onAnswer={(c) => api.answerGate(pw.project.id, `quiz:${i}`, c)}
        onContinue={last ? reload : () => setI(i + 1)}
        continueLabel={last ? "いじってみる" : "次の問題へ"}
      />
    </>
  );
}

// Projects made before the typing flow: one question at the end of a line-by-line read.
type Row = { key: string; code: string; meaning: string | null; words: CodeLine["words"] };

function translatedRows(blocks: ProjectBlockRow[]): Row[] {
  return blocks.flatMap((b): Row[] => linesOf(b).map((l, i) => ({ key: `${b.idx}-${i}`, ...l })));
}

function LineByLine({ pw, quiz, reload }: { pw: ProjectWithBlocks; quiz: ChoiceQuestion; reload: () => Promise<void> }) {
  const api = useApi();
  const rows = translatedRows(pw.blocks);
  const [shown, setShown] = useState(1);
  const done = shown >= rows.length;
  return (
    <>
      <Speech>
        <p className="explore-title">しくみ探検</p>
        <p>コードを1行ずつ、日本語に<b>翻訳</b>してみよう。</p>
        <p className="explore-count">{Math.min(shown, rows.length)} / {rows.length} 行</p>
      </Speech>
      <ol className="lbl glass">
        {rows.slice(0, shown).map((r, i) => (
          <li key={r.key} className={`lbl-row ${i === shown - 1 && !done ? "is-current" : ""}`}>
            <pre className="lbl-code"><code><Highlighted code={r.code.replace(/^\s+/, "")} /></code></pre>
            <p className="lbl-meaning">{r.meaning ?? "ここは自分でうめた・書いたところ。もう知ってるね！"}</p>
          </li>
        ))}
      </ol>
      {!done ? (
        <div className="pw-actions">
          <button className="btn btn-primary btn-lg" onClick={() => setShown((n) => n + 1)}>次の行へ <Icon name="send" /></button>
        </div>
      ) : (
        <GateQuestion
          label="最後に1問"
          question={quiz.question}
          choices={quiz.choices}
          onAnswer={(c) => api.answerGate(pw.project.id, "quiz", c)}
          onContinue={reload}
          continueLabel="いじってみる"
        />
      )}
    </>
  );
}

function ExploreStep({ pw, reload }: { pw: ProjectWithBlocks; reload: () => Promise<void> }) {
  const api = useApi();
  const quiz = pw.project.quiz;
  if (Array.isArray(quiz) && quiz.length && "code" in quiz[0]) return <CodeTest pw={pw} quiz={quiz as CodeQuiz[]} reload={reload} />;
  if (Array.isArray(quiz) && quiz.length) return <TestStep pw={pw} quiz={quiz as ChoiceQuestion[]} reload={reload} />;
  if (quiz && !Array.isArray(quiz)) return <LineByLine pw={pw} quiz={quiz} reload={reload} />;
  // Oldest projects: one question per explained block.
  const steps = pw.blocks.filter((b) => b.mode === "explain");
  const current = steps.find((b) => !b.explore_done);
  if (!current || !current.check_q) return null;
  const pos = steps.indexOf(current) + 1;
  return (
    <>
      <Speech>
        <p className="explore-count">しくみ探検 {pos} / {steps.length}</p>
        <p className="explore-title">{current.title}</p>
        <p>{current.explanation}</p>
      </Speech>
      <SegmentedCode blocks={pw.blocks} current={current.idx} />
      <GateQuestion
        key={current.id}
        label="確認しよう"
        question={current.check_q.question}
        choices={current.check_q.choices}
        onAnswer={(c) => api.answerGate(pw.project.id, `check:${current.idx}`, c)}
        onContinue={reload}
        continueLabel={pos === steps.length ? "いじってみる" : "次のしくみへ"}
      />
    </>
  );
}

// ------------------------------------------------------------------ tweak (written answer)
function TweakStep({ pw, reload }: { pw: ProjectWithBlocks; reload: () => Promise<void> }) {
  const api = useApi();
  const tweak = pw.project.tweak!;
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean; done: boolean } | null>(null);
  const [legacyAnswered, setLegacyAnswered] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      await api.finishProject(pw.project.id);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    try {
      const r = await api.answerTweak(pw.project.id, answer);
      setResult({ text: r.feedback, ok: r.passed, done: r.passed || r.revealed });
    } catch (e) {
      setResult({ text: (e as Error).message, ok: false, done: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Speech>
        <p className="explore-title">いじってみよう</p>
        <p><b>{tweak.instruction}</b></p>
        <p className="muted">Studioでやってみてから、どうなったかを書いてね。</p>
      </Speech>
      {tweak.choices ? (
        // Projects made before the written answer.
        !legacyAnswered ? (
          <GateQuestion
            label="予想する"
            question={tweak.question}
            choices={tweak.choices}
            onAnswer={(c) => api.answerGate(pw.project.id, "tweak", c)}
            onContinue={() => setLegacyAnswered(true)}
            continueLabel="Studioで確かめる"
          />
        ) : (
          <div className="run-report glass">
            <p>Studioで本当にそうなるか、確かめてみてね。</p>
            <button className="btn btn-primary btn-lg run-ok" disabled={busy} onClick={finish}>
              <Icon name="check" /> やってみた！ 完成にする
            </button>
          </div>
        )
      ) : (
        <section className="tweak-answer glass">
          <p className="tweak-question">{tweak.question}</p>
          <textarea
            className="input tweak-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="例：ふっとび方が〇〇になった"
            disabled={busy || Boolean(result?.done)}
            aria-label="やってみてどうなった？"
          />
          {result && <p className={`check-feedback ${result.ok ? "ok" : "ng"}`}>{result.text}</p>}
          <div className="pw-actions">
            {result?.done ? (
              <button className="btn btn-primary btn-lg run-ok" disabled={busy} onClick={finish}>
                <Icon name="check" /> 完成にする
              </button>
            ) : (
              <button className="btn btn-primary" disabled={busy || !answer.trim()} onClick={check}>
                {busy ? "AI先生が読んでいるよ…" : "AI先生に見てもらう"} <Icon name="send" size={16} />
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ done
/** Concepts whose recorded level went up in this project (for "できるようになったこと"). */
function useLevelUps(projectId: string) {
  const api = useApi();
  const [ups, setUps] = useState<{ concept: ConceptRow; level: number }[]>([]);
  useEffect(() => {
    Promise.all([api.listConceptEvents({ projectId }), api.listConcepts()]).then(([events, concepts]) => {
      const best = new Map<string, number>();
      for (const e of events as ConceptEventRow[]) if (e.level_after > e.level_before) best.set(e.concept_id, Math.max(best.get(e.concept_id) ?? 0, e.level_after));
      setUps([...best].map(([id, level]) => ({ concept: concepts.find((c) => c.id === id)!, level })).filter((x) => x.concept));
    }).catch(() => {});
  }, [api, projectId]);
  return ups;
}

function LevelUps({ projectId }: { projectId: string }) {
  const ups = useLevelUps(projectId);
  if (ups.length === 0) return null;
  return (
    <section className="levelups glass">
      <p className="run-label">できるようになったこと</p>
      <ul>
        {ups.map(({ concept, level }) => (
          <li key={concept.id}>
            <span className="lv-name">{concept.name}</span>
            <span className="lv-meter" aria-label={LEVEL_NAMES[level]}>
              {[1, 2, 3].map((n) => <i key={n} className={n <= level ? "on" : ""} />)}
            </span>
            <span className="lv-label">{LEVEL_NAMES[level]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DoneStep({ pw, onNew }: { pw: ProjectWithBlocks; onNew: () => void }) {
  return (
    <div className="pw-done">
      <Speech>
        <p className="explore-title">完成おめでとう！</p>
        <p>「{pw.project.title}」ができたね。仕組みもわかって、自分でいじることもできた！</p>
      </Speech>
      <LevelUps projectId={pw.project.id} />
      <div className="pw-actions">
        <button className="btn btn-primary btn-lg" onClick={onNew}>
          次の作品を作る <Icon name="send" />
        </button>
      </div>
    </div>
  );
}

/** Start screen: a project left unfinished in an earlier lesson. */
export function ResumeCard({ pw, onResume, onDrop }: { pw: ProjectWithBlocks; onResume: () => void; onDrop: () => void }) {
  const step = STAGES.findIndex((s) => s.id === pw.project.stage);
  return (
    <section className="resume glass">
      <span className="resume-icon"><Icon name="code" size={20} /></span>
      <div className="resume-body">
        <p className="resume-label">作りかけの作品があるよ</p>
        <p className="resume-title">{pw.project.title ?? pw.project.idea}</p>
        {step >= 0 && <p className="muted resume-step">{step + 1}. {STAGES[step].label} のところまで進んでいるよ</p>}
      </div>
      <div className="resume-actions">
        <button className="btn btn-primary" onClick={onResume}>つづきから作る <Icon name="send" size={16} /></button>
        <button className="link-btn" onClick={onDrop}>やめる</button>
      </div>
    </section>
  );
}

/** Shown on the start screen right after a project is finished. */
export function CompletedCard({ pw, onClose }: { pw: ProjectWithBlocks; onClose: () => void }) {
  return (
    <section className="completed glass">
      <div className="completed-head">
        <span className="completed-icon"><Icon name="check" size={20} /></span>
        <div>
          <p className="completed-title">「{pw.project.title}」完成おめでとう！</p>
          <p className="muted">仕組みもわかって、自分でいじることもできたね。次は何を作る？</p>
        </div>
        <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label="とじる"><Icon name="x" size={14} /></button>
      </div>
      <LevelUps projectId={pw.project.id} />
    </section>
  );
}

// ------------------------------------------------------------------ start (no project yet)
type IdeaImage = { id: string; blob: Blob; previewUrl: string };

export function IdeaStart({ sessionId, studentId, beforeStart, onStarted }: {
  sessionId: string;
  studentId: string;
  /** Runs before planning; false cancels (e.g. the student keeps an unfinished project). */
  beforeStart?: () => Promise<boolean>;
  onStarted: (pw: ProjectWithBlocks) => void;
}) {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [idea, setIdea] = useState("");
  const [images, setImages] = useState<IdeaImage[]>([]);
  const [tree, setTree] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addImages = async (files: File[]) => {
    const room = LIMITS.ideaImages - images.length;
    if (room <= 0) {
      setError(`画像は${LIMITS.ideaImages}枚までだよ。`);
      return;
    }
    const added = await Promise.all(files.slice(0, room).map(async (file) => {
      const blob = await prepareScreenshot(file);
      return { id: crypto.randomUUID(), blob, previewUrl: URL.createObjectURL(blob) };
    }));
    setImages((list) => [...list, ...added]);
  };

  const start = async (text: string) => {
    if (!text.trim()) return;
    if (beforeStart && !(await beforeStart())) return;
    setBusy(true);
    setError(null);
    try {
      const paths = await Promise.all(images.map((img) => api.uploadScreenshot(studentId, sessionId, img.blob)));
      onStarted(await api.planProject(sessionId, text, { images: paths, tree }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="idea glass">
      <div className="idea-head">
        <span className="idea-icon"><Icon name="code" size={20} /></span>
        <div>
          <h2 className="idea-title">作りたいものから始める</h2>
          <p className="muted">AI先生が動くコードを作るよ。そのあと、しくみをいっしょに探検しよう。</p>
        </div>
      </div>
      <div className="idea-row">
        <textarea
          className="input idea-input"
          value={idea}
          rows={2}
          maxLength={300}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && start(idea)}
          onPaste={(e) => {
            const files = imagesFromDataTransfer(e.clipboardData);
            if (files.length === 0) return;
            e.preventDefault(); // keep the image here instead of the chat box
            addImages(files);
          }}
          placeholder="作りたいものを書いてね"
          disabled={busy}
          aria-label="作りたいもの"
        />
        <button className="btn btn-primary" disabled={busy || !idea.trim()} onClick={() => start(idea)}>
          {busy ? "考え中…" : "作る"} <Icon name="send" size={16} />
        </button>
      </div>

      <div className="idea-tools">
        <button className={`tool ${images.length ? "is-on" : ""}`} onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="image" size={17} />
          <span className="tool-text">絵・画像をつける</span>
          {images.length > 0 && <span className="tool-count">{images.length}</span>}
        </button>
        <button
          className={`tool ${tree || showTree ? "is-on" : ""}`}
          onClick={() => setShowTree((v) => !v)}
          aria-expanded={showTree}
          disabled={busy}
        >
          <Icon name="tree" size={17} />
          <span className="tool-text">Studioの構成を入れる</span>
          {tree && <span className="tool-dot" />}
        </button>
      </div>

      {images.length > 0 && (
        <div className="thumbs">
          {images.map((img, i) => (
            <figure key={img.id} className="thumb">
              <img src={img.previewUrl} alt={`つけた画像 ${i + 1}`} />
              <button
                className="thumb-remove"
                onClick={() => {
                  URL.revokeObjectURL(img.previewUrl);
                  setImages((list) => list.filter((x) => x.id !== img.id));
                }}
                aria-label="画像を消す"
                disabled={busy}
              >
                <Icon name="x" size={12} />
              </button>
            </figure>
          ))}
        </div>
      )}

      {(showTree || tree) && <TreePaste value={tree} onChange={setTree} onClose={tree ? undefined : () => setShowTree(false)} />}

      {error && <p className="error-text">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter(isAcceptedImage);
          if (files.length) addImages(files);
          e.target.value = "";
        }}
      />
    </section>
  );
}
