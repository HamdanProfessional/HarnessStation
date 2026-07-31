/** Minimal SSE reader: calls onEvent with each `data:` payload string. */
export async function readSSE(
  response: Response,
  onEvent: (data: string) => void,
): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  if (!response.body) throw new Error("The server returned no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (line: string) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) onEvent(trimmed.slice(5).trim());
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) emit(line);
  }
  // A stream that ends without a trailing newline still has one event left in the
  // buffer — usually the final chunk carrying the usage totals.
  buffer += decoder.decode();
  if (buffer) emit(buffer);
}
