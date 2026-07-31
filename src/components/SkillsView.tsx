import { useEffect, useState } from "react";
import { confirmDialog } from "../lib/dialog";
import { EmptyState } from "./EmptyState";
import { IconBook } from "./icons";
import { toast } from "../lib/toast";
import { useStore } from "../lib/store";
import {
  STARTER_SKILLS,
  deleteSkill,
  listSkills,
  parseSkill,
  readSkillRaw,
  saveSkill,
  skillMarkdown,
  slugify,
  type Skill,
} from "../lib/skills";

interface EditingSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
  files: string[];
}

function emptySkill(): EditingSkill {
  return { slug: "", name: "New skill", description: "", body: "", files: [] };
}

export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<EditingSkill | null>(null);

  const refresh = async () => {
    const fresh = await listSkills();
    setSkills(fresh);
    useStore.setState({ skills: fresh });
  };

  useEffect(() => {
    void refresh();
  }, []);

  const addStarters = async () => {
    const existing = new Set(skills.map((s) => s.slug));
    const toAdd = STARTER_SKILLS.filter((p) => !existing.has(slugify(p.name)));
    if (!toAdd.length) {
      toast.info("All starter skills are already added.");
      return;
    }
    for (const p of toAdd) {
      await saveSkill(slugify(p.name), skillMarkdown(p.name, p.description, p.body));
    }
    toast.success(`Added ${toAdd.length} starter skill${toAdd.length > 1 ? "s" : ""}.`);
    await refresh();
  };

  const openEditor = async (s: Skill) => {
    const md = await readSkillRaw(s.slug);
    const { meta, body } = parseSkill(md);
    setEditing({ slug: s.slug, name: meta.name || s.name, description: meta.description || s.description, body, files: s.files });
  };

  const save = async () => {
    if (!editing) return;
    const slug = editing.slug || slugify(editing.name);
    await saveSkill(slug, skillMarkdown(editing.name, editing.description, editing.body));
    setEditing(null);
    await refresh();
  };

  // ---------- editor ----------
  if (editing) {
    const e = editing;
    const set = (p: Partial<EditingSkill>) => setEditing({ ...e, ...p });
    return (
      <main className="settings-main">
        <div className="settings-header">
          <h1>{e.slug ? "Edit skill" : "New skill"}</h1>
          <div>
            <button className="btn primary" onClick={() => void save()}>
              Save
            </button>{" "}
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>

        <label className="field">
          <span>Name</span>
          <input value={e.name} onChange={(ev) => set({ name: ev.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <input
            value={e.description}
            onChange={(ev) => set({ description: ev.target.value })}
            placeholder="Use when the user asks to..."
          />
          <span className="hint">
            This one line is what the model sees — describe WHEN to use this skill.
          </span>
        </label>
        <label className="field">
          <span>Instructions</span>
          <textarea
            rows={18}
            style={{ fontFamily: "monospace" }}
            value={e.body}
            onChange={(ev) => set({ body: ev.target.value })}
          />
        </label>

        {e.files.length > 0 && (
          <section>
            <h2>Bundled files</h2>
            <p className="hint">
              These files live alongside SKILL.md and can be referenced from the instructions above and
              read with read_file.
            </p>
            <ul>
              {e.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    );
  }

  // ---------- list ----------
  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Skills</h1>
        <div>
          <button className="btn" onClick={() => void addStarters()}>
            + Starter skills
          </button>{" "}
          <button className="btn primary" onClick={() => setEditing(emptySkill())}>
            New skill
          </button>
        </div>
      </div>
      <p className="hint">
        A skill is a folder of instructions the model loads only when relevant, so it stays cheap. It
        works in chat, agents, and the voice avatar (enable the use_skill tool).
      </p>
      <div className="card-grid">
        {skills.map((s) => (
          <div key={s.slug} className="cloud-card">
            <div className="cloud-card-head">
              <span className="cloud-logo">{s.name.slice(0, 1).toUpperCase()}</span>
              <div className="grow">
                <div className="cloud-name">{s.name}</div>
                <div className="cloud-by">{s.slug}</div>
              </div>
            </div>
            <div className="cloud-blurb">
              {s.description}
              {s.files.length > 0 && (
                <>
                  <br />
                  {s.files.length} bundled file{s.files.length > 1 ? "s" : ""}
                </>
              )}
            </div>
            <div className="cloud-foot">
              <button className="link-btn" onClick={() => void openEditor(s)}>
                Edit
              </button>
              <button
                className="link-btn danger-link"
                onClick={async () => {
                  if (await confirmDialog(`Delete skill ${s.name}?`, { danger: true })) {
                    await deleteSkill(s.slug);
                    await refresh();
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {skills.length === 0 && (
        <EmptyState
          icon={<IconBook size={22} />}
          title="No skills yet"
          hint="A skill is a folder of instructions the model loads on demand, keeping the system prompt small."
          action={{ label: "New skill", onClick: () => setEditing(emptySkill()) }}
          secondary={{ label: "Add starter skills", onClick: () => void addStarters() }}
        />
      )}
    </main>
  );
}
