// Sample data for ?demo=1 (no backend needed). Mirrors what end-session writes for 体験授業.
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

const KEY_CODE = [
  "if math.random(1,10) == 1 then",
  '\tlocal boom = Instance.new("Explosion")',
  "\tboom.Position = key.Position",
  "\tboom.DestroyJointRadiusPercent = 0 -- これがないと たおれちゃう",
  "\tboom.BlastRadius = 20",
  "\tboom.BlastPressure = 500000",
  "\tboom.Parent = workspace",
  "end",
].join("\n");

const DOOR_CODE = [
  "local door = script.Parent",
  "local detector = door.ClickDetector",
  "",
  "detector.MouseClick:Connect(function()",
  "\tdoor.Transparency = 0.7",
].join("\n");

export function demoFamily() {
  const lessons = [{ id: "trial", title: "体験授業", emoji: "" }];
  return {
    children: [{ id: "child-1", display_name: "田中" }],
    summaries: [
      {
        id: "a",
        student_id: "child-1",
        created_today: "キーをふむと、ときどき爆発するしかけ",
        learned: [
          "「新しいものを作って、ゲームの世界に置く」という、ものを出すときの基本の流れを学びました。",
          "サイコロのように数をランダムに選んで、「たまにだけ」動くしかけを作る方法を学びました。",
        ],
        struggled_with: ["爆発がとどく広さを2倍にする問題で、どこの数字を変えればよいかを考えるのに少し時間がかかりました。"],
        how_student_solved_it:
          "1行ずつ説明を読みながらコードを自分で打ちこみ、最後のテストではコードを書きかえて、2問を自分の力で正解しました。",
        next_lesson: "爆発以外にも、色や音が変わるしかけに挑戦します。",
        parent_summary:
          "今日は、ゲームの中のキーをふむと、ときどき爆発するしかけを作りました。説明を読みながら8行のコードを自分の手で打ちこみ、最後は数字を書きかえて動きを変えるテストにも取り組みました。",
        metrics: {
          minutes: 50,
          questions: 2,
          hints_used: 0,
          max_hint_level: 0,
          checks_total: 0,
          checks_correct_first_try: 0,
          checks_solved: 0,
          completed: true,
          projects_completed: 1,
          concepts_up: [
            { name: "if文（条件）", level: 1 },
            { name: "ものを作る", level: 1 },
            { name: "プロパティを変える", level: 1 },
          ],
          tests_total: 3,
          tests_first_try: 1,
          tests_solved: 2,
          typed_lines: 8,
          written_by_self: 0,
          works: [{ title: "たまに爆発するキー", done: true, code: KEY_CODE }],
        },
        created_at: daysAgo(0),
        session: { lesson_id: "trial", started_at: daysAgo(0) },
      },
      {
        id: "b",
        student_id: "child-1",
        created_today: "クリックで開くドア",
        learned: ["クリックされたことを受け取って、ものの見た目を変える方法を学びました。"],
        struggled_with: [],
        how_student_solved_it: "ドアがすけるところまで、説明を読みながら打ちこみました。次回、通れるようにするところから続けます。",
        next_lesson: "ドアを通れるようにして、完成させます。",
        parent_summary: "今日は、クリックすると開くドアづくりに取り組みました。仕組みを一つずつ確かめながら、ていねいに進めています。",
        metrics: {
          minutes: 45,
          questions: 4,
          hints_used: 0,
          max_hint_level: 0,
          checks_total: 0,
          checks_correct_first_try: 0,
          checks_solved: 0,
          completed: false,
          projects_completed: 0,
          concepts_up: [{ name: "クリックで動かす", level: 1 }],
          tests_total: 0,
          tests_first_try: 0,
          tests_solved: 0,
          typed_lines: 4,
          written_by_self: 1,
          works: [{ title: "クリックで開くドア", done: false, code: DOOR_CODE }],
        },
        created_at: daysAgo(7),
        session: { lesson_id: "trial", started_at: daysAgo(7) },
      },
    ],
    activeSessions: [],
    lessons,
  };
}
