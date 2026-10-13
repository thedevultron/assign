import { HugeiconsIcon } from '@hugeicons/react';
import {
  DashboardSquare01Icon, KanbanIcon, AiBrain01Icon, WorkflowSquare10Icon, Settings01Icon, Activity01Icon, Add01Icon,
  Search01Icon, Calendar03Icon, Clock01Icon, Delete02Icon, PencilEdit02Icon, Cancel01Icon, ArrowRight01Icon,
  SidebarLeftIcon, PlayIcon, PauseIcon, Copy01Icon, Tick02Icon, FlashIcon, Alert02Icon, Mail01Icon, Notification03Icon,
  FilterIcon, Plug01Icon, Refresh01Icon, MoreHorizontalIcon, Menu01Icon, ArrowDown01Icon, Upload04Icon, Route01Icon,
  Comment01Icon, InboxIcon, Folder01Icon, Image01Icon, CheckmarkCircle02Icon, SparklesIcon, UserIcon, GitBranchIcon,
  Target02Icon, TimeScheduleIcon, Rocket01Icon, MailSend01Icon, Key01Icon, ArrowUpRight01Icon, RoboticIcon, Link01Icon,
  Download04Icon, Logout01Icon, LockPasswordIcon, Globe02Icon, ArrowLeft01Icon, EyeIcon, ViewOffIcon, Shield01Icon,
  DatabaseExportIcon, UserGroupIcon, CodeIcon, Layers01Icon, ZapIcon, CommandIcon, CheckListIcon, File01Icon, Github01Icon,
  ComputerTerminal01Icon, ArrowUp01Icon, Analytics01Icon, ChartLineData01Icon,
  Mic01Icon, MicOff01Icon, ArrowShrink02Icon, CallEnd01Icon, AiVoiceIcon, AiChat02Icon, StopIcon, KeyboardIcon, AiMagicIcon, AudioWave01Icon, MoreVerticalIcon,
} from '@hugeicons/core-free-icons';

const MAP = {
  chart: Analytics01Icon, trend: ChartLineData01Icon,
  dashboard: DashboardSquare01Icon, board: KanbanIcon, agents: AiBrain01Icon, automations: WorkflowSquare10Icon,
  settings: Settings01Icon, activity: Activity01Icon, plus: Add01Icon, search: Search01Icon, calendar: Calendar03Icon,
  clock: Clock01Icon, trash: Delete02Icon, edit: PencilEdit02Icon, close: Cancel01Icon, right: ArrowRight01Icon,
  sidebar: SidebarLeftIcon, play: PlayIcon, pause: PauseIcon, copy: Copy01Icon, check: Tick02Icon, flash: FlashIcon,
  alert: Alert02Icon, mail: Mail01Icon, bell: Notification03Icon, filter: FilterIcon, plug: Plug01Icon, refresh: Refresh01Icon,
  more: MoreHorizontalIcon, menu: Menu01Icon, chevron: ArrowDown01Icon, upload: Upload04Icon, route: Route01Icon,
  comment: Comment01Icon, inbox: InboxIcon, folder: Folder01Icon, image: Image01Icon, done: CheckmarkCircle02Icon,
  sparkles: SparklesIcon, user: UserIcon, branch: GitBranchIcon, target: Target02Icon, schedule: TimeScheduleIcon,
  rocket: Rocket01Icon, send: MailSend01Icon, key: Key01Icon, external: ArrowUpRight01Icon, robot: RoboticIcon, link: Link01Icon,
  download: Download04Icon, logout: Logout01Icon, lock: LockPasswordIcon, globe: Globe02Icon, left: ArrowLeft01Icon,
  eye: EyeIcon, eyeOff: ViewOffIcon, shield: Shield01Icon, export: DatabaseExportIcon, team: UserGroupIcon, code: CodeIcon,
  layers: Layers01Icon, zap: ZapIcon, command: CommandIcon, checklist: CheckListIcon, file: File01Icon, github: Github01Icon,
  terminal: ComputerTerminal01Icon, up: ArrowUp01Icon,
  mic: Mic01Icon, micOff: MicOff01Icon, shrink: ArrowShrink02Icon, hangup: CallEnd01Icon, voice: AiVoiceIcon, chat: AiChat02Icon,
  stop: StopIcon, keyboard: KeyboardIcon, magic: AiMagicIcon, wave: AudioWave01Icon, moreV: MoreVerticalIcon,
};

export default function Icon({ name, size = 20, stroke = 1.5, className, style }) {
  const icon = MAP[name];
  if (!icon) return null;
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} color="currentColor" className={className} style={style} />;
}
