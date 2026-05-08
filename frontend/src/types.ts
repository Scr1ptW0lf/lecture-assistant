export type AppMode = "lite" | "full";

export interface TranscriptLine {
  id: string;    // start timestamp "H:MM:SS.cc"
  end: string;   // end timestamp "H:MM:SS.cc"
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
