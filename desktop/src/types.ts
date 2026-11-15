export interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  type: 'text' | 'word' | 'pdf' | 'excel' | 'image' | 'other' | string;
  path: string;
  url?: string;
  dataUrl?: string;
}

export interface ToolAction {
  id: string;
  tool: string;
  display: 'Pwsh' | 'Read' | 'Edit' | 'Grep' | 'Glob' | string;
  desc: string;
  path?: string;
  args?: Record<string, any>;
  status?: 'running' | 'success' | 'error' | 'interrupted';
  output?: string;
  elapsed?: number;
  timestamp: number;
}

export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
}

export interface TrajectoryStep {
  id: string;
  type: 'tool' | 'assistant' | 'user';
  tool?: string;
  display?: string;
  desc?: string;
  path?: string;
  args?: Record<string, any> | string;
  output?: string;
  status?: 'running' | 'success' | 'error' | 'interrupted';
  elapsed?: number;
  thought?: string;
  content?: string;
  timestamp?: number;
}

export interface CriticDimension {
  name: string;
  score?: number;
  passed?: boolean;
  detail?: string;
}

export interface TurnData {
  turn_id: number;
  user_prompt: string;
  attachments?: AttachmentItem[];
  thought?: string;
  assistant_response?: string;
  actions: ToolAction[];
  steps?: TrajectoryStep[];
  timestamp?: number;
  start_timestamp?: number;
  completed_timestamp?: number;
  elapsed?: number;
  is_paused?: boolean;
  permission_mode?: string;
  tasks?: TaskItem[];
  status_message?: string;
  critic?: {
    status: 'reviewing' | 'rejected' | 'passed';
    reason?: string;
    score?: number;
    loop?: number;
    fix?: string;
    dimensions?: CriticDimension[];
  };
}

export interface MessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolActions?: ToolAction[];
}

export interface SessionInfo {
  session_id: string;
  is_active: boolean;
  turn_count: number;
  modified_files_count?: number;
  current_goal?: string;
  title?: string;
  has_disk_file?: boolean;
  time_ago?: string;
  is_pinned?: boolean;
}

export interface ProjectInfo {
  name: string;
  path?: string;
  session_count: number;
  sessions: SessionInfo[];
  is_pinned?: boolean;
}

export interface ModelProvider {
  id?: string;
  name: string;
  base_url: string;
  api_key_masked?: string;
  api_key?: string;
  models: string[];
  is_custom: boolean;
  protocol?: string;
  status: 'connected' | 'unconfigured';
}



export interface SystemStatus {
  ready: boolean;
  project_name: string;
  workspace_path: string;
  active_session_id: string;
  model: string;
  permission_mode: string;
  turn_count: number;
  tools_count: number;
  mcp_clients_count: number;
}
export interface UserInputRequest {
  request_id: string;
  question: string;
  header?: string;
  options?: string[];
  allow_custom?: boolean;
  session_id?: string;
  project?: string;
}

export interface TrajectoryMetric {
  label: string;
  value: string;
  sub?: string;
  status: 'good' | 'warning' | 'info' | 'error';
}

export interface TrajectoryDiagnostic {
  type: 'pass' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface TrajectoryStepAnnotation {
  agent_role?: 'planner' | 'worker' | 'critic' | string;
  diagnosis?: string;
  badge_type?: 'success' | 'warning' | 'info' | 'error' | string;
  is_redundant?: boolean;
}

export interface TurnEvalItem {
  turn_id: number;
  user_prompt?: string;
  health_score: number;
  health_level: 'A+' | 'A' | 'B' | 'C' | string;
  tool_calls_count: number;
  tool_errors_count: number;
  tool_success_rate: string;
  redundant_calls_count: number;
  elapsed: string;
  tokens: number;
  task_completion_rate: string;
  critic_score?: string;
  critic_status?: 'passed' | 'rejected' | 'reviewing' | 'none' | string;
  critic_reason?: string;
  turn_summary: string;
  step_ids?: string[];
}

export interface TrajectoryEvalReport {
  session_id: string;
  project: string;
  timestamp: number;
  health_score: number;
  health_level: 'A+' | 'A' | 'B' | 'C' | string;
  summary: string;
  metrics: {
    tool_success_rate: string;
    tool_calls_count: number;
    tool_errors_count: number;
    efficiency_score: string;
    redundant_calls_count: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_elapsed: string;
    task_completion_rate: string;
    critic_pass_rate: string;
    self_healing_count: number;
  };
  metric_cards: TrajectoryMetric[];
  diagnostics: TrajectoryDiagnostic[];
  step_annotations?: Record<string, TrajectoryStepAnnotation>;
  turns_eval?: TurnEvalItem[];
}
