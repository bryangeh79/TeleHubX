export interface ReplyTemplate {
  triggers: string[];
  response: string;
}

// Simple keyword-trigger FAQ template matcher.
// Templates are checked in insertion order; first match wins.
export class TemplateService {
  private templates: ReplyTemplate[] = [];

  constructor(templates: ReplyTemplate[] = []) {
    this.templates = [...templates];
  }

  // Returns the response for the first template whose any trigger substring-matches
  // the incoming text (case-insensitive). Returns null if no match.
  match(text: string): string | null {
    const lower = text.toLowerCase();
    for (const tpl of this.templates) {
      if (tpl.triggers.some((t) => lower.includes(t.toLowerCase()))) {
        return tpl.response;
      }
    }
    return null;
  }

  add(template: ReplyTemplate): void {
    this.templates.push(template);
  }

  remove(trigger: string): void {
    this.templates = this.templates.filter(
      (t) => !t.triggers.some((tr) => tr.toLowerCase() === trigger.toLowerCase()),
    );
  }

  list(): ReplyTemplate[] {
    return [...this.templates];
  }
}
