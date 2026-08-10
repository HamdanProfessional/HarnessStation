import { EmptyState, IconCompass, IconChat } from "@harnessstation/ui-kit";

export const FirstRun = () => (
  <EmptyState
    icon={<IconCompass size={28} />}
    title="No agents yet"
    hint="Create your first agent to start automating tasks with your models."
    action={{ label: "Create agent", onClick: () => {} }}
    secondary={{ label: "Browse starters", onClick: () => {} }}
  />
);

export const NoResults = () => (
  <EmptyState
    icon={<IconChat size={28} />}
    title="No conversations found"
    hint="Try a different search, or start a new chat."
    action={{ label: "New chat", onClick: () => {} }}
  />
);

export const Minimal = () => (
  <EmptyState title="Nothing here" hint="This panel is empty." />
);
