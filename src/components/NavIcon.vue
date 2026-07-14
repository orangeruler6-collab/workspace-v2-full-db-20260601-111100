<template>
  <component :is="iconComponent" :size="size" :stroke-width="1.8" aria-hidden="true" />
</template>

<script setup>
import { computed } from 'vue'
import {
  Activity,
  Archive,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Calculator,
  CalendarDays,
  ChartColumnBig,
  ChartNoAxesCombined,
  ChartSpline,
  ChevronDown,
  CircleDot,
  Clapperboard,
  Flame,
  Image,
  LibraryBig,
  Lightbulb,
  ListOrdered,
  LogOut,
  MessageCircleMore,
  MessagesSquare,
  MessageSquareText,
  PenLine,
  RadioTower,
  ScanSearch,
  ScrollText,
  Target,
  TrendingUp,
  UserCog,
  UsersRound,
  Workflow,
  Wrench
} from 'lucide-vue-next'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 17 }
})

const ICONS = {
  accountmonitor: TrendingUp,
  trafficPlan: Target,
  dailyhot: Flame,
  accountDataWorkbench: ChartNoAxesCombined,
  accountDataDashboard: ChartSpline,
  accountDataAccounts: UsersRound,
  ops: ChartColumnBig,
  copyWorkbench: PenLine,
  styleLibrary: LibraryBig,
  styleProjectWorkbench: BriefcaseBusiness,
  styleWriter: MessagesSquare,
  workflow: Workflow,
  styleAssets: MessageCircleMore,
  tools: Wrench,
  styleGrossMargin: Calculator,
  styleDouyinHotlist: ListOrdered,
  projectAgent: Bot,
  ideoboard: Lightbulb,
  schedule: CalendarDays,
  imagegen: Image,
  posttools: Clapperboard,
  videopublish: RadioTower,
  material: Archive,
  smartcollect: ScanSearch,
  feedback: MessageSquareText,
  vector: BrainCircuit,
  adminUsers: UserCog,
  operationLogs: ScrollText,
  systemHealth: Activity,
  chevron: ChevronDown,
  logout: LogOut
}

const iconComponent = computed(() => ICONS[props.name] || CircleDot)
</script>
