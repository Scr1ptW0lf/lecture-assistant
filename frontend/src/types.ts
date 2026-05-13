export type AppMode = "lite" | "full";

export interface TranscriptLine {
  id: string;         // unique dedup key (may include :n suffix)
  displayTs: string;  // clean timestamp for UI display ("H:MM:SS.cc")
  end: string;
  text: string;
  nameDetected: boolean;
  timestamp: number;
  final: boolean;
}

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  streaming: boolean;
}

export interface Summary {
  id: string;
  text: string;
  streaming: boolean;
}

export interface AudioDevice {
  index: number;
  name: string;
  is_recommended: boolean;
}

export interface EngineSettings {
  whisper_model: string;
  whisper_device: string;
  whisper_compute_type: string;
  ollama_model: string;
  ollama_num_gpu: number;
  mode: AppMode;
}

export interface SessionData {
  version: number;
  saved_at: string;
  student_name?: string;
  content_type?: string;
  user_context?: string;
  lines: TranscriptLine[];
  summaries: Summary[];
}
