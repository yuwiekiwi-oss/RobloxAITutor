import { useEffect, useState } from "react";
import { useApi } from "../../lib/api";
import type { ConceptRow, StudentConceptRow } from "../../lib/types";
import { LEVEL_NAMES } from "../student/project/stages";

/** Per-student concept mastery (recorded, not AI-estimated). Teachers can correct a level. */
export function MasteryPanel({ studentId }: { studentId: string }) {
  const api = useApi();
  const [concepts, setConcepts] = useState<ConceptRow[]>([]);
  const [levels, setLevels] = useState<Record<string, StudentConceptRow>>({});
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listConcepts(), api.getMastery(studentId)])
      .then(([c, m]) => {
        setConcepts(c);
        setLevels(Object.fromEntries(m.map((x) => [x.concept_id, x])));
      })
      .catch((e: Error) => setError(e.message));
  }, [api, studentId]);

  const change = async (conceptId: string, level: number) => {
    try {
      const row = await api.setConceptLevel(studentId, conceptId, level);
      setLevels((l) => ({ ...l, [conceptId]: row }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reset = async () => {
    if (!window.confirm("この生徒の習熟度をすべて「初見」にもどします。よろしいですか？\n（これまでの記録の履歴は残ります）")) return;
    try {
      await api.resetMastery(studentId);
      setLevels({});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const touched = concepts.filter((c) => (levels[c.id]?.level ?? 0) > 0);
  const list = showAll ? concepts : touched;

  return (
    <section className="mastery">
      <h3>
        習熟度 <span>{touched.length} / {concepts.length}</span>
      </h3>
      <p className="mastery-note">記録（解説の確認問題・穴うめ・自分で書いた結果）から決まります。必要なら先生が直せます。</p>
      {list.length === 0 && <p className="muted">まだ記録がありません。</p>}
      <ul className="mastery-list">
        {list.map((c) => {
          const lv = levels[c.id]?.level ?? 0;
          return (
            <li key={c.id}>
              <span className="mastery-name" title={c.kid_hint}>{c.name}</span>
              <span className="mastery-meter" aria-hidden>
                {[1, 2, 3].map((n) => <i key={n} className={n <= lv ? `on lv-${lv}` : ""} />)}
              </span>
              <select
                className="mastery-select"
                value={lv}
                onChange={(e) => change(c.id, Number(e.target.value))}
                aria-label={`${c.name}の習熟度`}
              >
                {LEVEL_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
              </select>
            </li>
          );
        })}
      </ul>
      <div className="mastery-actions">
        <button className="link-btn" onClick={() => setShowAll(!showAll)}>
          {showAll ? "記録があるものだけ表示" : "すべての考え方を表示"}
        </button>
        {touched.length > 0 && (
          <button className="link-btn mastery-reset" onClick={reset}>習熟度をリセット</button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
