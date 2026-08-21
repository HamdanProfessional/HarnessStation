import { chatCapable, groupByModality, MODALITY_LABEL } from "../lib/modality";

/**
 * The `<option>` list for any select that picks a model to *talk to*.
 *
 * Providers return one flat array with speech, image, embedding and guardrail
 * models mixed into the chat ones, and there are five of these selects — chat
 * config, agents, compare, evals, multi-agent. Sharing the list means they
 * cannot disagree about what a model is, and a rule added to the classifier
 * reaches all five at once.
 *
 * Grouped, never filtered. The modality is inferred from the id, so it can be
 * wrong; a model in the wrong group is untidy, but a model missing from the
 * list looks like the provider stopped offering it and is unfixable from the
 * UI. Groups a chat cannot send to say so in their heading.
 */
export function ModelOptions({ models }: { models: string[] }) {
  return (
    <>
      {groupByModality(models).map((g) => (
        <optgroup
          key={g.modality}
          label={
            chatCapable(g.modality)
              ? MODALITY_LABEL[g.modality]
              : `${MODALITY_LABEL[g.modality]} — not usable in a chat`
          }
        >
          {g.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
