export type Status = "pending" | "edited" | "updated" | "deleted";

export interface QAEntry {
  id: string;
  global_idx: number;
  chapter_num: number;
  chapter_title: string;
  chapter_theme: string;
  category: string;
  label: string;
  emoji: string;
  source_url: string;
  five_w: Record<string, string>;
  narrative: string;
  expert_reactions: string[];
  related_cases: string[];
  status: Status;
  factcheck_result?: string;
  [key: string]: any;
}

export interface Stats {
  total: number;
  edited: number;
  pending: number;
  updated: number;
}
