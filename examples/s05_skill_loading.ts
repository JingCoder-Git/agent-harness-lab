type Skill = {
  name: string;
  description: string;
  body: string;
};

function createSkillLoader(skills: Skill[]) {
  function list() {
    return skills.map(({ name, description }) => ({ name, description }));
  }

  function load(name: string) {
    return skills.find((skill) => skill.name === name)?.body;
  }

  return { list, load };
}

async function agentWithSkills(
  request: string,
  loader: ReturnType<typeof createSkillLoader>
) {
  const available = loader.list();
  const selected = available.find((skill) => request.includes(skill.name));
  if (!selected) return "No skill needed.";

  const skillText = loader.load(selected.name);
  return `Loaded skill into context:\n${skillText}`;
}

agentWithSkills(
  "Use the pdf skill",
  createSkillLoader([{ name: "pdf", description: "Read PDFs", body: "PDF workflow..." }])
);

export {};
