// Explorer tree from Roblox Studio, without a plugin: the student pastes TREE_COMMAND into the
// Command Bar, then copies what it prints in the Output window back into the app.
// Pure module (used by the web app and the Edge Functions).

export const TREE_START = "=== AI-SENSEI TREE START ===";
export const TREE_END = "=== AI-SENSEI TREE END ===";
export const TREE_MAX_CHARS = 12000;
/** First line inside the markers: the place name (game.Name), used to label saved trees. */
const PLACE_PREFIX = "PLACE: ";

/**
 * One line of read-only Luau (the Command Bar runs one line). It prints the main services as an
 * indented tree, merges same-named siblings ("Cloud (Part) x151"), skips decorations
 * (textures, welds, UI layout objects) and player characters, and caps the size per service.
 */
export const TREE_COMMAND =
  'local o={"' + TREE_START + '","' + PLACE_PREFIX + '"..game.Name} local P=game:GetService("Players") ' +
  "local S={Texture=1,Decal=1,SpecialMesh=1,Weld=1,WeldConstraint=1,SurfaceAppearance=1,TouchTransmitter=1," +
  "UICorner=1,UIStroke=1,UIGradient=1,UIPadding=1,UIScale=1,UIListLayout=1,UIGridLayout=1," +
  "UITextSizeConstraint=1,UIAspectRatioConstraint=1,UISizeConstraint=1} " +
  "local n,L local function w(i,d,k) " +
  'if n>=L then if n==L then table.insert(o,string.rep("  ",d).."...") n+=1 end return end n+=1 ' +
  'table.insert(o,string.rep("  ",d)..i.Name.." ("..i.ClassName..")"..(k>1 and " x"..k or "")) ' +
  "local g,c={},{} for _,x in ipairs(i:GetChildren()) do " +
  'if not(S[x.ClassName] or x:IsA("Camera") or x:IsA("Terrain") or P:GetPlayerFromCharacter(x)) then ' +
  'local y=x.Name.."|"..x.ClassName if c[y] then c[y]+=1 else c[y]=1 table.insert(g,{x,y}) end end end ' +
  'if d>=6 then if #g>0 then table.insert(o,string.rep("  ",d+1).."...") end return end ' +
  "for _,e in ipairs(g) do w(e[1],d+1,c[e[2]]) end end " +
  'for _,s in ipairs({"Workspace","ServerScriptService","StarterPlayer","StarterGui","ReplicatedStorage","ServerStorage","StarterPack"}) do ' +
  'n=0 L=(s=="Workspace" and 200 or 60) w(game:GetService(s),0,1) end ' +
  'table.insert(o,"' + TREE_END + '") print(table.concat(o,"\\n"))';

/**
 * Pulls the tree out of whatever the student copied from the Output window (timestamps,
 * "- Edit" labels, other log lines around it). Returns null if the markers are missing.
 */
export function extractTree(pasted: string): string | null {
  return parseTree(pasted)?.tree ?? null;
}

/** The tree plus the place name printed with it (copies made before the name was added have none). */
export function parseTree(pasted: string): { tree: string; place: string | null } | null {
  const start = pasted.indexOf(TREE_START);
  if (start < 0) return null;
  const from = start + TREE_START.length;
  const end = pasted.indexOf(TREE_END, from);
  const lines = (end < 0 ? pasted.slice(from) : pasted.slice(from, end))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim());
  let place: string | null = null;
  if (lines[0]?.trim().startsWith(PLACE_PREFIX)) {
    place = lines.shift()!.trim().slice(PLACE_PREFIX.length).trim().slice(0, 60) || null;
  }
  const tree = lines.join("\n").slice(0, TREE_MAX_CHARS);
  return tree ? { tree, place } : null;
}

/** Kid-readable size of a tree: parts / models and scripts (counting "x12" groups). */
export function treeStats(tree: string): { parts: number; scripts: number } {
  let parts = 0;
  let scripts = 0;
  for (const line of tree.split("\n")) {
    const m = line.match(/\((\w+)\)(?: x(\d+))?\s*$/);
    if (!m) continue;
    const n = m[2] ? Number(m[2]) : 1;
    if (/^(Script|LocalScript|ModuleScript)$/.test(m[1])) scripts += n;
    else if (/^(Part|MeshPart|UnionOperation|WedgePart|TrussPart|SpawnLocation|Seat|Model)$/.test(m[1])) parts += n;
  }
  return { parts, scripts };
}

/** Number of lines in a tree (for "読みこめた！ ○こ"). */
export const treeSize = (tree: string) => tree.split("\n").length;

/** Server side: accept a tree only if it is a string; keep it within the size limit. */
export function cleanTree(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return (extractTree(v) ?? v.trim()).slice(0, TREE_MAX_CHARS);
}
