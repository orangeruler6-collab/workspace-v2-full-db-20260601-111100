"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Calculator, ChevronDown, Copy, FolderOpen, ListPlus, RefreshCw, RotateCcw, Save, Target, Trash2 } from "lucide-react";
import { useFeedback } from "@/components/FeedbackProvider";
import { getGrossMarginLibrary, saveGrossMarginPriceTable } from "@/lib/client";
import { copyTextToClipboard } from "./_components/clipboard";
import { isHostAdmin, normalizeHostAuthUser, readHostAuthUser, writeHostAuthUser, type HostAuthUser } from "./_components/host-auth";
import type {
  GrossMarginCalculationLine,
  GrossMarginCalculationResult,
  GrossMarginAccountPrice,
  GrossMarginLibrary,
  GrossMarginPriceOption,
  GrossMarginPriceTable,
  GrossMarginServiceKind
} from "@/lib/types";

type PlatformKey = GrossMarginPriceTable["platform"];

type ServiceConfig = {
  service: GrossMarginServiceKind;
  label: string;
};

type MaintenanceBaseRecord = {
  id: string;
  groupName: string;
  targetName: string;
  source?: "traffic-plan";
  sourceProjectId?: string;
  sourceAccountExecutionId?: string;
  platform: PlatformKey;
  accountName: string;
  videoUrl: string;
  originalPrice: string;
  discountRate: string;
  discountPrice: string;
  targetPlayWan: string;
  targetCpm: string;
  phaseName: string;
  phaseRatio: string;
  maintenanceCost: number;
  exportedReviewText: string;
  quantityInputs: Record<GrossMarginServiceKind, string>;
  selectedOptions: Partial<Record<GrossMarginServiceKind, string>>;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type TrafficMaintenanceContext = {
  source?: string;
  projectId?: string;
  projectName?: string;
  accountExecutionId?: string;
  accountName?: string;
  platform?: PlatformKey;
  phaseName?: string;
  videoUrl?: string;
  originalPrice?: string;
  discountPrice?: string;
  discountRate?: string;
  targetCpm?: string;
  targetPlayWan?: string;
};

type DouyinPresetConfig = {
  basePlayWan: string;
  like: string;
  favorite: string;
  share: string;
  comment: string;
};

type GroupMaintenanceConfig = {
  groupName: string;
  preset: DouyinPresetConfig;
  priceInputs: Partial<Record<PlatformKey, Record<string, string>>>;
  updatedAt: string;
};

const maintenanceRecordStorageKey = "usagi:gross-margin:maintenance-records:v1";
const groupConfigStorageKey = "usagi:gross-margin:group-configs:v1";
const defaultDouyinPreset: DouyinPresetConfig = {
  basePlayWan: "30",
  like: "10000",
  favorite: "200",
  share: "100",
  comment: "200"
};
const contentGroupMembers = [
  { groupName: "内容一组", members: ["许树杰", "许梦婷", "刘登魁", "许国锬", "叶进生", "高明镇", "薛荐轩", "叶颖"] },
  { groupName: "内容二组", members: ["傅思敏", "赵良杰", "陈乐恒", "吴恒", "李扬林", "施律彬", "罗晓棋"] },
  { groupName: "内容三组", members: ["曹媛", "陈泓睿", "林文涛", "刘佳琳", "肖子璇"] },
  { groupName: "内容四组", members: ["姚希", "陈健伊", "宋丽佳", "林宇辰"] },
  { groupName: "内容五组", members: ["朱信宇", "林心语", "商光涵", "杨鸿霆", "吴楷煌"] },
  { groupName: "内容六组", members: ["廖李星", "吴皓轩", "林孝添", "林语婷", "张碧珊", "叶子健"] }
];
const phaseRatioOptions = ["40", "50", "60", "70", "80", "90", "100"];
const targetCpmOptions = ["30", "40", "50", "60", "70", "80", "90", "100"];
const platformOptions: Array<{ value: PlatformKey; label: string }> = [
  { value: "douyin", label: "抖音" },
  { value: "bilibili", label: "B站" }
];

const serviceConfigs: ServiceConfig[] = [
  { service: "play", label: "播放" },
  { service: "like", label: "点赞" },
  { service: "favorite", label: "收藏" },
  { service: "share", label: "转发" },
  { service: "comment", label: "评论" },
  { service: "danmaku", label: "弹幕" },
  { service: "douPlus", label: "dou+" },
  { service: "coin", label: "投币" },
  { service: "blueLink", label: "蓝链点击" }
];

const pricePanelServiceConfigs = serviceConfigs.filter((config) => config.service !== "douPlus");

export default function GrossMarginPage() {
  const { notify } = useFeedback();
  const [library, setLibrary] = useState<GrossMarginLibrary | null>(null);
  const [platform, setPlatform] = useState<PlatformKey>("douyin");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [accountName, setAccountName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [discountRate, setDiscountRate] = useState("");
  const [discountPrice, setDiscountPrice] = useState("");
  const [quantityInputs, setQuantityInputs] = useState<Record<GrossMarginServiceKind, string>>({
    play: "",
    like: "",
    douPlus: "",
    coin: "",
    comment: "",
    share: "",
    favorite: "",
    danmaku: "",
    blueLink: ""
  });
  const [selectedOptions, setSelectedOptions] = useState<Partial<Record<GrossMarginServiceKind, string>>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [recordTargetName, setRecordTargetName] = useState("");
  const [activeRecordId, setActiveRecordId] = useState("");
  const [activeProjectName, setActiveProjectName] = useState("");
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceBaseRecord[]>([]);
  const [groupConfigs, setGroupConfigs] = useState<GroupMaintenanceConfig[]>([]);
  const [targetPlayWan, setTargetPlayWan] = useState("");
  const [targetCpm, setTargetCpm] = useState("50");
  const [phaseName, setPhaseName] = useState("一期");
  const [phaseRatio, setPhaseRatio] = useState("50");
  const [reviewText, setReviewText] = useState("");
  const [reviewDirty, setReviewDirty] = useState(false);
  const lastReviewDraftRef = useRef("");
  const [hostUser, setHostUser] = useState<HostAuthUser | null>(null);
  const [clientStorageReady, setClientStorageReady] = useState(false);
  const [trafficContext, setTrafficContext] = useState<TrafficMaintenanceContext | null>(null);
  const tables = useMemo(() => library?.tables || [], [library]);
  const table = useMemo(
    () => tables.find((item) => item.platform === platform) || tables[0] || null,
    [platform, tables]
  );
  const platformAccounts = useMemo(
    () => (library?.accounts || []).filter((account) => account.platform === platform),
    [library, platform]
  );
  const matchedAccount = useMemo(
    () => findGrossMarginAccount(platformAccounts, accountName),
    [accountName, platformAccounts]
  );
  const activeServiceConfigs = useMemo(
    () => serviceConfigs.filter((config) => (table ? getServiceOptions(table, config.service).length > 0 : false)),
    [table]
  );
  const activePricePanelServiceConfigs = useMemo(
    () => pricePanelServiceConfigs.filter((config) => (table ? getServiceOptions(table, config.service).length > 0 : false)),
    [table]
  );
  const calculation = useMemo(
    () => calculateGrossMargin({
      discountPrice: toAmount(discountPrice),
      originalPrice: toAmount(originalPrice),
      configs: activeServiceConfigs,
      priceInputs,
      quantityInputs,
      selectedOptions,
      table
    }),
    [activeServiceConfigs, discountPrice, originalPrice, priceInputs, quantityInputs, selectedOptions, table]
  );
  const currentGroupName = useMemo(() => getUserGroupName(hostUser), [hostUser]);
  const cumulativeMaintenanceCost = useMemo(
    () => calculateCumulativeMaintenanceCost(maintenanceRecords.filter((record) => !record.archivedAt || record.id === activeRecordId), {
      activeRecordId,
      currentCost: calculation.maintenanceCost,
      groupName: currentGroupName,
      phaseName,
      targetName: recordTargetName
    }),
    [activeRecordId, calculation.maintenanceCost, currentGroupName, maintenanceRecords, phaseName, recordTargetName]
  );
  const cumulativeGrossProfit = calculation.discountPrice - cumulativeMaintenanceCost;
  const cumulativeGrossMarginRate = calculation.originalPrice > 0 ? cumulativeGrossProfit / calculation.originalPrice : 0;
  const reviewDraft = useMemo(
    () => buildGrossMarginReview({
      account: matchedAccount,
      accountName,
      calculation,
      cumulativeCost: cumulativeMaintenanceCost,
      platform,
      phaseName,
      videoUrl
    }),
    [accountName, calculation, cumulativeMaintenanceCost, matchedAccount, phaseName, platform, videoUrl]
  );
  const visibleReviewText = reviewDirty ? reviewText : reviewDraft;
  const configuredPriceCount = table?.items.filter((item) => toAmount(priceInputs[item.id] ?? item.unitPrice) > 0).length || 0;
  const canEditPrices = isHostAdmin(hostUser);
  const currentGroupConfig = useMemo(() => getGroupConfig(groupConfigs, currentGroupName), [currentGroupName, groupConfigs]);
  const douyinPreset = currentGroupConfig.preset;
  const visibleMaintenanceRecords = useMemo(
    () =>
      maintenanceRecords.filter((record) => {
        if (record.archivedAt) return false;
        if (normalizeGroupName(record.groupName) !== normalizeGroupName(currentGroupName)) return false;
        if (activeProjectName && normalizeProjectName(record.targetName) !== normalizeProjectName(activeProjectName)) return false;
        return true;
      }),
    [activeProjectName, currentGroupName, maintenanceRecords]
  );
  const groupedMaintenanceRecords = useMemo(() => groupMaintenanceRecords(visibleMaintenanceRecords), [visibleMaintenanceRecords]);
  const archivedMaintenanceRecords = useMemo(
    () =>
      maintenanceRecords.filter(
        (record) => record.archivedAt && normalizeGroupName(record.groupName) === normalizeGroupName(currentGroupName)
      ),
    [currentGroupName, maintenanceRecords]
  );
  const archivedProjectRecords = useMemo(() => groupProjectRecords(archivedMaintenanceRecords), [archivedMaintenanceRecords]);

  useEffect(() => {
    setMaintenanceRecords(readMaintenanceRecords());
    setGroupConfigs(readGroupConfigs());
    setHostUser(readHostAuthUser());
    setClientStorageReady(true);
  }, []);

  useEffect(() => {
    let ignore = false;
    getGrossMarginLibrary()
      .then((result) => {
        if (ignore) return;
        setLibrary(result);
        const nextTable = result.tables.find((item) => item.platform === "douyin") || result.tables[0] || null;
        if (nextTable) {
          setPlatform(nextTable.platform);
          setSelectedOptions(makeDefaultSelections(nextTable));
        }
      })
      .catch((error) => {
        if (!ignore) notify({ tone: "error", message: error instanceof Error ? error.message : "读取毛利单价表失败" });
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [notify]);

  useEffect(() => {
    window.parent?.postMessage({ type: "usagi-auth-request" }, window.location.origin);

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "usagi-auth-user") {
        const nextUser = normalizeHostAuthUser(event.data.user);
        setHostUser(nextUser);
        writeHostAuthUser(nextUser);
      }
      if (event.data?.type === "usagi-traffic-maintenance-context") {
        applyTrafficMaintenanceContext(event.data.payload);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!clientStorageReady) return;
    writeMaintenanceRecords(maintenanceRecords);
  }, [clientStorageReady, maintenanceRecords]);

  useEffect(() => {
    if (!clientStorageReady) return;
    writeGroupConfigs(groupConfigs);
  }, [clientStorageReady, groupConfigs]);

  useEffect(() => {
    if (lastReviewDraftRef.current === reviewDraft) return;
    lastReviewDraftRef.current = reviewDraft;
    setReviewDirty(false);
    setReviewText(reviewDraft);
  }, [reviewDraft]);

  useEffect(() => {
    if (!table) return;
    setPriceInputs({
      ...makePriceInputs(table),
      ...(currentGroupConfig.priceInputs[table.platform] || {})
    });
  }, [currentGroupConfig, table]);

  useEffect(() => {
    applyDouyinPresetValues();
  }, [
    discountPrice,
    douyinPreset.basePlayWan,
    douyinPreset.comment,
    douyinPreset.favorite,
    douyinPreset.like,
    douyinPreset.share,
    originalPrice,
    phaseRatio,
    platform,
    table,
    targetCpm,
    targetPlayWan
  ]);

  function handlePlatformChange(nextPlatform: PlatformKey) {
    setPlatform(nextPlatform);
    const nextTable = tables.find((item) => item.platform === nextPlatform) || null;
    if (!nextTable) return;
    setSelectedOptions(makeDefaultSelections(nextTable));
    const nextAccount = findGrossMarginAccount(
      (library?.accounts || []).filter((account) => account.platform === nextPlatform),
      accountName
    );
    if (nextAccount) updateOriginalPrice(String(nextAccount.defaultPrice));
  }

  function handleAccountNameChange(value: string) {
    setAccountName(value);
    const nextAccount = findGrossMarginAccount(platformAccounts, value);
    if (nextAccount) updateOriginalPrice(String(nextAccount.defaultPrice));
  }

  function applyTrafficMaintenanceContext(rawContext: TrafficMaintenanceContext | null | undefined) {
    if (!rawContext || rawContext.source !== "traffic-plan") return;
    const nextPlatform = rawContext.platform === "bilibili" ? "bilibili" : "douyin";
    setTrafficContext(rawContext);
    setActiveRecordId("");
    setActiveProjectName("");
    setPlatform(nextPlatform);
    setRecordTargetName(rawContext.projectName || "");
    setAccountName(rawContext.accountName || "");
    setVideoUrl(rawContext.videoUrl || "");
    setOriginalPrice(rawContext.originalPrice || "");
    setDiscountPrice(rawContext.discountPrice || rawContext.originalPrice || "");
    setDiscountRate(rawContext.discountRate || (rawContext.discountPrice || rawContext.originalPrice ? "100" : ""));
    setTargetCpm(rawContext.targetCpm || "50");
    setTargetPlayWan(rawContext.targetPlayWan || "");
    setPhaseName(rawContext.phaseName || "一期");
    setReviewDirty(false);
    setReviewText("");
    notify({ tone: "success", message: "已从投流计划带入维护申请信息" });
  }

  function updateOriginalPrice(value: string) {
    setOriginalPrice(value);
    if (discountRate.trim()) {
      setDiscountPrice(formatAmountInput(toAmount(value) * toAmount(discountRate) / 100));
    }
  }

  function handleDiscountRateChange(value: string) {
    setDiscountRate(value);
    if (value.trim()) {
      setDiscountPrice(formatAmountInput(toAmount(originalPrice) * toAmount(value) / 100));
    }
  }

  function handleNewMaintenanceRecord() {
    setActiveRecordId("");
    setActiveProjectName("");
    setRecordTargetName("");
    setAccountName("");
    setVideoUrl("");
    setOriginalPrice("");
    setDiscountRate("");
    setDiscountPrice("");
    setTargetPlayWan("");
    setTargetCpm("50");
    setPhaseName("一期");
    setPhaseRatio("50");
    setReviewText("");
    setReviewDirty(false);
    setQuantityInputs(makeEmptyQuantityInputs());
    if (table) setSelectedOptions(makeDefaultSelections(table));
  }

  function handleSaveMaintenanceRecord() {
    const nextRecord = saveMaintenanceRecord(phaseName);
    if (!nextRecord) return;
    notify({ tone: "success", message: "投放申请记录已保存" });
  }

  function handlePhaseNameChange(nextPhaseName: string) {
    setPhaseName(nextPhaseName);
    setReviewDirty(false);
    setReviewText("");
  }

  function buildReviewTextForPhase(nextPhaseName: string, preferCurrentEditor: boolean) {
    const normalizedPhaseName = nextPhaseName || phaseName || "本次";
    if (preferCurrentEditor && reviewText.trim()) return reviewText.trim();
    const nextCumulativeCost = calculateCumulativeMaintenanceCost(maintenanceRecords.filter((record) => !record.archivedAt || record.id === activeRecordId), {
      activeRecordId,
      currentCost: calculation.maintenanceCost,
      groupName: currentGroupName,
      phaseName: normalizedPhaseName,
      targetName: recordTargetName
    });
    return buildGrossMarginReview({
      account: matchedAccount,
      accountName,
      calculation,
      cumulativeCost: nextCumulativeCost,
      platform,
      phaseName: normalizedPhaseName,
      videoUrl
    });
  }

  function saveMaintenanceRecord(nextPhaseName: string, nextReviewText?: string) {
    const groupName = currentGroupName;
    const targetName = recordTargetName.trim();
    const normalizedPhaseName = nextPhaseName || phaseName || "本次";
    if (!targetName) {
      notify({ tone: "error", message: "请先填写标的" });
      return null;
    }

    const now = new Date().toISOString();
    const existing = findExistingMaintenanceRecord(maintenanceRecords, {
      activeRecordId,
      groupName,
      sourceAccountExecutionId: trafficContext?.source === "traffic-plan" ? trafficContext.accountExecutionId || "" : "",
      targetName,
      accountName,
      platform,
      videoUrl,
      phaseName: normalizedPhaseName
    });
    const nextRecord: MaintenanceBaseRecord = {
      id: existing?.id || `gm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      groupName,
      targetName,
      source: trafficContext?.source === "traffic-plan" ? "traffic-plan" : existing?.source,
      sourceProjectId: trafficContext?.source === "traffic-plan" ? trafficContext.projectId || existing?.sourceProjectId : existing?.sourceProjectId,
      sourceAccountExecutionId: trafficContext?.source === "traffic-plan" ? trafficContext.accountExecutionId || existing?.sourceAccountExecutionId : existing?.sourceAccountExecutionId,
      platform,
      accountName: accountName.trim(),
      videoUrl: videoUrl.trim(),
      originalPrice,
      discountRate,
      discountPrice,
      targetPlayWan,
      targetCpm,
      phaseName: normalizedPhaseName,
      phaseRatio,
      maintenanceCost: calculation.maintenanceCost,
      exportedReviewText: nextReviewText || (reviewDirty ? reviewText.trim() : buildReviewTextForPhase(normalizedPhaseName, false)),
      quantityInputs: { ...quantityInputs },
      selectedOptions: { ...selectedOptions },
      archivedAt: undefined,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    setMaintenanceRecords((current) =>
      [nextRecord, ...current.filter((record) => record.id !== nextRecord.id && getMaintenanceRecordKey(record) !== getMaintenanceRecordKey(nextRecord))].sort(
        (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
      )
    );
    setActiveRecordId(nextRecord.id);
    setActiveProjectName(nextRecord.targetName);
    setPhaseName(normalizedPhaseName);
    return nextRecord;
  }

  function handleLoadMaintenanceRecord(record: MaintenanceBaseRecord) {
    setActiveRecordId(record.id);
    setActiveProjectName(record.targetName);
    setRecordTargetName(record.targetName);
    setPlatform(record.platform);
    const nextTable = tables.find((item) => item.platform === record.platform) || table;
    setSelectedOptions({ ...(nextTable ? makeDefaultSelections(nextTable) : {}), ...record.selectedOptions });
    setQuantityInputs({ ...makeEmptyQuantityInputs(), ...record.quantityInputs });
    setAccountName(record.accountName);
    setVideoUrl(record.videoUrl);
    setOriginalPrice(record.originalPrice);
    setDiscountRate(record.discountRate);
    setDiscountPrice(record.discountPrice);
    setTargetPlayWan(record.targetPlayWan || "");
    setTargetCpm(record.targetCpm || "50");
    setPhaseName(record.phaseName || "一期");
    setPhaseRatio(record.phaseRatio || "50");
    const hasCompleteReviewText = Boolean(record.exportedReviewText && /维护后毛利率/.test(record.exportedReviewText));
    setReviewText(hasCompleteReviewText ? record.exportedReviewText : "");
    setReviewDirty(hasCompleteReviewText);
  }

  function handleDeleteMaintenanceRecord(recordId: string) {
    setMaintenanceRecords((current) => current.filter((record) => record.id !== recordId));
    if (activeRecordId === recordId) setActiveRecordId("");
  }

  function handleArchiveProject(projectName: string) {
    const normalizedProjectName = normalizeProjectName(projectName);
    const now = new Date().toISOString();
    setMaintenanceRecords((current) =>
      current.map((record) =>
        normalizeGroupName(record.groupName) === normalizeGroupName(currentGroupName) &&
        normalizeProjectName(record.targetName) === normalizedProjectName
          ? { ...record, archivedAt: record.archivedAt || now, updatedAt: now }
          : record
      )
    );
    if (normalizeProjectName(activeProjectName) === normalizedProjectName) setActiveProjectName("");
    if (activeRecordId) {
      const activeRecord = maintenanceRecords.find((record) => record.id === activeRecordId);
      if (activeRecord && normalizeProjectName(activeRecord.targetName) === normalizedProjectName) setActiveRecordId("");
    }
    notify({ tone: "success", message: "项目已归档" });
  }

  function handleRestoreProject(projectName: string) {
    const normalizedProjectName = normalizeProjectName(projectName);
    const now = new Date().toISOString();
    setMaintenanceRecords((current) =>
      current.map((record) =>
        normalizeGroupName(record.groupName) === normalizeGroupName(currentGroupName) &&
        normalizeProjectName(record.targetName) === normalizedProjectName
          ? { ...record, archivedAt: undefined, updatedAt: now }
          : record
      )
    );
    setActiveProjectName(projectName);
    notify({ tone: "success", message: "项目已恢复" });
  }

  function handleQuantityInputChange(service: GrossMarginServiceKind, value: string) {
    if (service === "play") {
      const playWan = resolvePresetPlayWan(targetPlayWan, discountPrice, originalPrice, targetCpm);
      setPhaseRatio(inferPhaseRatioFromPlayInput(value, {
        playWan,
        preset: douyinPreset,
        selectedOptions,
        table
      }));
    }
    setQuantityInputs((current) => ({
      ...current,
      [service]: value
    }));
  }

  function applyDouyinPresetValues() {
    if (platform !== "douyin") {
      return;
    }
    const playWan = resolvePresetPlayWan(targetPlayWan, discountPrice, originalPrice, targetCpm);
    if (playWan <= 0) {
      return;
    }
    if (phaseRatio === "custom") {
      return;
    }

    const ratio = clampRatio(toAmount(phaseRatio || 100));
    const phasePlayWan = playWan * ratio / 100;
    const preset = buildDouyinPresetQuantities(phasePlayWan, douyinPreset);
    const nextSelectedOptions = {
      ...selectedOptions,
      play: findDouyinLowQualityPlayOption(table)?.id || selectedOptions.play
    };
    const optionUnits = getSelectedServiceUnits(table, nextSelectedOptions);
    setTargetPlayWan(formatAmountInput(playWan));
    if (nextSelectedOptions.play !== selectedOptions.play) setSelectedOptions(nextSelectedOptions);
    setQuantityInputs((current) => ({
      ...current,
      play: formatPresetPlayQuantity(preset.playWan, optionUnits.play),
      like: formatPresetQuantity(preset.like, optionUnits.like),
      favorite: formatPresetQuantity(preset.favorite, optionUnits.favorite),
      share: formatPresetQuantity(preset.share, optionUnits.share),
      comment: formatPresetQuantity(preset.comment, optionUnits.comment),
      douPlus: "0"
    }));
  }

  function handleApplyDouyinPreset() {
    if (platform !== "douyin") {
      notify({ tone: "error", message: "当前预设只适用于抖音" });
      return;
    }
    const playWan = resolvePresetPlayWan(targetPlayWan, discountPrice, originalPrice, targetCpm);
    if (playWan <= 0) {
      notify({ tone: "error", message: "请先填写目标播放量，或填写价格和 CPM" });
      return;
    }
    applyDouyinPresetValues();
    notify({ tone: "success", message: `${phaseName || "本期"}抖音预设已填入` });
  }

  function handleVideoUrlChange(value: string) {
    setVideoUrl(normalizeVideoUrlInput(value));
  }

  function handlePresetConfigChange(field: keyof DouyinPresetConfig, value: string) {
    setGroupConfigs((current) => upsertGroupConfig(current, currentGroupName, {
      preset: {
        ...getGroupConfig(current, currentGroupName).preset,
        [field]: value
      }
    }));
  }

  function saveCurrentGroupPriceInputs(nextPlatform: PlatformKey, nextPriceInputs: Record<string, string>) {
    setGroupConfigs((current) => upsertGroupConfig(current, currentGroupName, {
      priceInputs: {
        ...getGroupConfig(current, currentGroupName).priceInputs,
        [nextPlatform]: nextPriceInputs
      }
    }));
  }

  async function handleRefresh() {
    setBusy("refresh");
    try {
      const result = await getGrossMarginLibrary();
      setLibrary(result);
      const nextTable = result.tables.find((item) => item.platform === platform) || result.tables[0] || null;
      if (nextTable) {
        setPlatform(nextTable.platform);
        setSelectedOptions(makeDefaultSelections(nextTable));
      }
      notify({ tone: "success", message: "毛利单价表已刷新" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "刷新失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleSavePriceTable() {
    if (!table) return;
    if (!canEditPrices) {
      notify({ tone: "error", message: "只有管理员可以修改平台单价表" });
      return;
    }
    setBusy("prices");
    try {
      const result = await saveGrossMarginPriceTable({
        platform: table.platform,
        items: table.items.map((item) => ({
          ...item,
          unitPrice: toAmount(priceInputs[item.id] ?? item.unitPrice)
        }))
      });
      setLibrary(result.library);
      saveCurrentGroupPriceInputs(result.table.platform, makePriceInputs(result.table));
      notify({ tone: "success", message: `${formatPlatform(table.platform)}单价表已保存` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "保存单价表失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleExportReview(nextPhaseName: string) {
    if (!accountName.trim()) {
      notify({ tone: "error", message: "请先填写账号名，再导出审核文案" });
      return;
    }
    if (!videoUrl.trim()) {
      notify({ tone: "error", message: "请先补视频链接，再导出审核文案" });
      return;
    }
    const normalizedPhaseName = nextPhaseName || phaseName || "本次";
    const isCurrentEditorPhase = normalizePhaseName(normalizedPhaseName) === normalizePhaseName(phaseName);
    const exportedReviewText = buildReviewTextForPhase(normalizedPhaseName, isCurrentEditorPhase && reviewDirty);
    const savedRecord = saveMaintenanceRecord(normalizedPhaseName, exportedReviewText);
    if (!savedRecord) return;
    try {
      await copyTextToClipboard(savedRecord.exportedReviewText || exportedReviewText);
      notify({ tone: "success", message: `${savedRecord.phaseName}文案已复制，历史已保存` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "复制失败" });
    }
  }

  return (
    <div className="page gross-margin-page">
      <header className="page-header">
        <div>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              🧮
            </span>
            <span>数据维护</span>
          </h1>
          <p className="subtle">左边改报价，中间填本次数量，右边自动算维护成本和毛利率。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">2 个平台</span>
          <span className="stat-pill">{configuredPriceCount} 个单价已填</span>
          <span className="stat-pill">{currentGroupName} · {groupedMaintenanceRecords.reduce((sum, group) => sum + group.records.length, 0)} 条历史</span>
          <button className="btn" disabled={busy === "refresh"} onClick={() => void handleRefresh()} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            {busy === "refresh" ? "刷新中" : "刷新"}
          </button>
        </div>
      </header>

      <div className="gross-compact-status" aria-label="数据维护状态">
        <strong>数据维护</strong>
        <span>{currentGroupName}</span>
        <span>{configuredPriceCount} 个单价</span>
        <button className="btn" disabled={busy === "refresh"} onClick={() => void handleRefresh()} type="button">
          <RefreshCw aria-hidden="true" size={14} />
          {busy === "refresh" ? "刷新中" : "刷新"}
        </button>
      </div>

      {trafficContext ? (
        <div className="notice">
          投流计划来源：{trafficContext.projectName || "未命名项目"} / {trafficContext.phaseName || phaseName} / {trafficContext.accountName || accountName}
        </div>
      ) : null}

      <section className="panel three-pane gross-margin-workspace" aria-label="数据维护工作区">
        <aside className="pane gross-base-pane">
          <div className="pane-header">
            <div>
              <h2>维护基地</h2>
              <p className="pane-subtitle">按当前用户组查看历史维护记录</p>
            </div>
            <button className="btn icon-btn" onClick={handleNewMaintenanceRecord} type="button" aria-label="新建投放申请">
              <ListPlus aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="pane-body">
            <div className="detail-section gross-record-form">
              <div className="gross-current-group">
                <span>当前组</span>
                <strong>{currentGroupName}</strong>
              </div>
              {activeProjectName ? (
                <button className="btn ghost gross-project-filter-clear" onClick={() => setActiveProjectName("")} type="button">
                  查看全部项目
                </button>
              ) : null}
              <div className="field">
                <label htmlFor="gross-record-target">标的 / 项目</label>
                <input
                  autoComplete="off"
                  id="gross-record-target"
                  value={recordTargetName}
                  onChange={(event) => setRecordTargetName(event.target.value)}
                  placeholder="本次投放标的或项目名"
                />
              </div>
              <button className="btn primary" onClick={handleSaveMaintenanceRecord} type="button">
                <Save aria-hidden="true" size={15} />
                {activeRecordId ? "更新历史" : "保存历史"}
              </button>
            </div>

            <div className="gross-record-list" aria-label="投放申请记录">
              {groupedMaintenanceRecords.length ? (
                groupedMaintenanceRecords.map((group) => (
                  <section className="gross-record-group" key={group.name}>
                    <h3>
                      <FolderOpen aria-hidden="true" size={14} />
                      <span>{group.name}</span>
                    <small>{group.records.length} 期</small>
                    </h3>
                    {group.projects.map((project) => (
                      <div className="gross-record-project" key={project.name}>
                        <div className="gross-record-project-head">
                          <button className="gross-record-project-name" onClick={() => setActiveProjectName(project.name)} type="button">
                            {project.name}
                          </button>
                          <button className="btn icon-btn icon-only" onClick={() => handleArchiveProject(project.name)} type="button" aria-label="归档项目">
                            <Archive aria-hidden="true" size={14} />
                          </button>
                        </div>
                        <div className="gross-record-items">
                          {project.records.map((record) => (
                            <article className={`gross-record-item${record.id === activeRecordId ? " active" : ""}`} key={record.id}>
                              <button className="gross-record-main" onClick={() => handleLoadMaintenanceRecord(record)} type="button">
                                <strong>{record.phaseName || "本次"}</strong>
                                <span>{formatPlatform(record.platform)} · {formatPhaseRatio(record.phaseRatio)} · {formatRecordDate(record.updatedAt)}</span>
                              </button>
                              <button className="btn icon-btn icon-only" onClick={() => handleDeleteMaintenanceRecord(record.id)} type="button" aria-label="删除投放申请">
                                <Trash2 aria-hidden="true" size={14} />
                              </button>
                            </article>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                ))
              ) : (
                <div className="empty-state-panel panel compact">
                  <div className="panel-inner">
                    <span className="empty-state-mark">
                      <Target aria-hidden="true" size={17} />
                    </span>
                    <p className="subtle">当前组还没有历史记录。</p>
                  </div>
                </div>
              )}
            </div>

            {archivedProjectRecords.length ? (
              <details className="gross-price-drawer gross-archive-drawer">
                <summary>
                  <span>
                    <Archive aria-hidden="true" size={15} />
                    归档池
                  </span>
                  <small>{archivedProjectRecords.length} 项目</small>
                  <ChevronDown aria-hidden="true" size={15} />
                </summary>
                <div className="gross-archive-list">
                  {archivedProjectRecords.map((project) => (
                    <div className="gross-archive-project" key={project.name}>
                      <strong>{project.name}</strong>
                      <small>{project.records.length} 期</small>
                      <button className="btn icon-btn icon-only" onClick={() => handleRestoreProject(project.name)} type="button" aria-label="恢复项目">
                        <RotateCcw aria-hidden="true" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            <details className="gross-price-drawer">
              <summary>
                <span>
                  <Calculator aria-hidden="true" size={15} />
                  组内配置
                </span>
                <small>{configuredPriceCount} 已填</small>
                <ChevronDown aria-hidden="true" size={15} />
              </summary>
              <div className="gross-price-drawer-body">
                <section className="gross-preset-config" aria-label="抖音预设比例">
                  <h3>抖音预设</h3>
                  <div className="gross-preset-config-grid">
                    <label>
                      <span>播放(万)</span>
                      <input inputMode="decimal" type="text" value={douyinPreset.basePlayWan} onChange={(event) => handlePresetConfigChange("basePlayWan", event.target.value)} />
                    </label>
                    <label>
                      <span>点赞</span>
                      <input inputMode="decimal" type="text" value={douyinPreset.like} onChange={(event) => handlePresetConfigChange("like", event.target.value)} />
                    </label>
                    <label>
                      <span>收藏</span>
                      <input inputMode="decimal" type="text" value={douyinPreset.favorite} onChange={(event) => handlePresetConfigChange("favorite", event.target.value)} />
                    </label>
                    <label>
                      <span>转发</span>
                      <input inputMode="decimal" type="text" value={douyinPreset.share} onChange={(event) => handlePresetConfigChange("share", event.target.value)} />
                    </label>
                    <label>
                      <span>评论</span>
                      <input inputMode="decimal" type="text" value={douyinPreset.comment} onChange={(event) => handlePresetConfigChange("comment", event.target.value)} />
                    </label>
                  </div>
                </section>
                <div className="source-tabs gross-platform-tabs" role="group" aria-label="选择平台">
                  {platformOptions.map((option) => (
                    <button
                      aria-pressed={platform === option.value}
                      className={platform === option.value ? "active" : ""}
                      key={option.value}
                      onClick={() => handlePlatformChange(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <p className="subtle">正在读取本地毛利单价表。</p>
                ) : table ? (
                  <>
                    <div className="gross-price-groups">
                      {activePricePanelServiceConfigs.map((config) => (
                        <PriceGroup
                          config={config}
                          items={getServiceOptions(table, config.service)}
                          key={config.service}
                          locked={!canEditPrices}
                          priceInputs={priceInputs}
                          onPriceChange={(id, value) => setPriceInputs((current) => ({ ...current, [id]: value }))}
                        />
                      ))}
                    </div>
                    {!canEditPrices ? <p className="field-hint">平台单价表已锁定，只有 admin 可以修改。</p> : null}
                    <button className="btn primary" disabled={busy === "prices" || !canEditPrices} onClick={() => void handleSavePriceTable()} type="button">
                      <Save aria-hidden="true" size={15} />
                      {busy === "prices" ? "保存中" : "保存单价表"}
                    </button>
                  </>
                ) : (
                  <p className="subtle">单价表还没有初始化，请刷新后重试。</p>
                )}
              </div>
            </details>
          </div>
        </aside>

        <section className="pane gross-maintenance-pane">
          <div className="pane-header">
            <div>
              <h2>{formatPlatform(platform)}本次维护</h2>
              <p className="pane-subtitle">折前价格、折后价格和每项数量都填在这里</p>
            </div>
          </div>
          <div className="pane-body">
            <div className="detail-section gross-price-summary-form">
              <div className="gross-target-row">
                <div className="field">
                  <label htmlFor="gross-target-play">目标播放量</label>
                  <span className="gross-rate-input">
                    <input
                      id="gross-target-play"
                      inputMode="decimal"
                      type="text"
                      value={targetPlayWan}
                      onChange={(event) => setTargetPlayWan(event.target.value)}
                      placeholder="例如 40"
                    />
                    <small>万</small>
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="gross-target-cpm">目标 CPM</label>
                  <select id="gross-target-cpm" value={targetCpm} onChange={(event) => setTargetCpm(event.target.value)}>
                    {targetCpmOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="gross-phase-name">期数</label>
                  <select id="gross-phase-name" value={phaseName} onChange={(event) => handlePhaseNameChange(event.target.value)}>
                    <option value="一期">一期</option>
                    <option value="二期">二期</option>
                    <option value="三期">三期</option>
                    <option value="本次">本次</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="gross-phase-ratio">本期比例</label>
                  <select id="gross-phase-ratio" value={phaseRatio} onChange={(event) => setPhaseRatio(event.target.value)}>
                    {phaseRatioOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}%
                      </option>
                    ))}
                    <option value="custom">自定义</option>
                  </select>
                </div>
                <button className="btn primary" disabled={platform !== "douyin"} onClick={handleApplyDouyinPreset} type="button">
                  <Calculator aria-hidden="true" size={15} />
                  套抖音预设
                </button>
                <p className="field-hint">
                  {platform === "douyin"
                    ? `按当前组预设计算；播放按 5w、点赞按 1k、互动按 50 向上取整，dou+ 为 0。预算约 ${formatMoney(estimateCpmBudget(targetPlayWan, targetCpm))}。`
                    : "互动预设只适用于抖音，B站请手填。"}
                </p>
              </div>
              <div className="gross-account-row">
                <div className="field">
                  <label htmlFor="gross-account-name">账号名</label>
                  <input
                    autoComplete="off"
                    id="gross-account-name"
                    list="gross-account-options"
                    type="text"
                    value={accountName}
                    onChange={(event) => handleAccountNameChange(event.target.value)}
                    placeholder="输入账号名自动带价格"
                  />
                  <datalist id="gross-account-options">
                    {platformAccounts.map((account) => (
                      <option key={`${account.platform}-${account.name}`} value={account.name} />
                    ))}
                  </datalist>
                  {matchedAccount ? (
                    <span className="field-hint">
                      已匹配{matchedAccount.priceLabel}：{formatMoney(matchedAccount.defaultPrice)}
                    </span>
                  ) : accountName.trim() ? (
                    <span className="field-hint warning">未匹配账号，价格可手填</span>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="gross-video-url">视频链接</label>
                  <input
                    autoComplete="off"
                    id="gross-video-url"
                    type="url"
                    value={videoUrl}
                    onChange={(event) => handleVideoUrlChange(event.target.value)}
                    placeholder="粘贴链接或整段分享文案"
                  />
                </div>
              </div>
              <div className="gross-price-summary-grid">
                <div className="field">
                  <label htmlFor="gross-original-price">折前价格</label>
                  <input
                    id="gross-original-price"
                    inputMode="decimal"
                    min={0}
                    type="number"
                    value={originalPrice}
                    onChange={(event) => updateOriginalPrice(event.target.value)}
                    placeholder="原档位价格"
                  />
                </div>
                <div className="field">
                  <label htmlFor="gross-discount-rate">折扣率</label>
                  <span className="gross-rate-input">
                    <input
                      id="gross-discount-rate"
                      inputMode="decimal"
                      min={0}
                      type="number"
                      value={discountRate}
                      onChange={(event) => handleDiscountRateChange(event.target.value)}
                      placeholder="可不填"
                    />
                    <small>%</small>
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="gross-discount-price">折后价格</label>
                  <input
                    id="gross-discount-price"
                    inputMode="decimal"
                    min={0}
                    type="number"
                    value={discountPrice}
                    onChange={(event) => setDiscountPrice(event.target.value)}
                    placeholder="实际报价"
                  />
                </div>
              </div>
            </div>

            <div className="gross-maintenance-table-wrap">
              <table className="gross-maintenance-table">
                <thead>
                  <tr>
                    <th>维护项</th>
                    <th>类型</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>小计</th>
                  </tr>
                </thead>
                <tbody>
                  {activeServiceConfigs.map((config) => {
                    const options = table ? getServiceOptions(table, config.service) : [];
                    const selectedOption = getSelectedOption(options, selectedOptions[config.service]);
                    const unitPrice = selectedOption ? toAmount(priceInputs[selectedOption.id] ?? selectedOption.unitPrice) : 0;
                    const quantity = toQuantityAmount(quantityInputs[config.service], selectedOption?.quantityUnit);
                    const minimumWarning = getMinimumQuantityWarning(
                      selectedOption,
                      quantityInputs[config.service],
                      quantity
                    );
                    return (
                      <tr key={config.service}>
                        <td>
                          <strong>{config.label}</strong>
                          <span>{describeQuantityInput(selectedOption?.quantityUnit)}</span>
                        </td>
                        <td>
                          <select
                            aria-label={`${config.label}类型`}
                            value={selectedOption?.id || ""}
                            onChange={(event) =>
                              setSelectedOptions((current) => ({
                                ...current,
                                [config.service]: event.target.value
                              }))
                            }
                          >
                            {options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {formatTypeOptionName(option.name)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="gross-quantity-cell">
                            <span className={`gross-quantity-input${minimumWarning ? " gross-input-warning" : ""}`}>
                              <input
                                aria-label={`${config.label}数量`}
                                inputMode="decimal"
                                type="text"
                                value={quantityInputs[config.service]}
                                onChange={(event) => handleQuantityInputChange(config.service, event.target.value)}
                              />
                              <small>{selectedOption?.quantityUnit || "个"}</small>
                            </span>
                            {minimumWarning ? <small className="gross-quantity-warning">{minimumWarning}</small> : null}
                          </div>
                        </td>
                        <td>{formatUnitPrice(unitPrice)}</td>
                        <td>{formatMoney(quantity * unitPrice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="pane gross-result-pane">
          <div className="pane-header">
            <div>
              <h2>结果</h2>
              <p className="pane-subtitle">毛利率 = （折后价格 - 累计维护成本） / 折前价格</p>
            </div>
          </div>
          <div className="pane-body">
            <div className="gross-result-panel maintenance">
              <span>累计维护成本</span>
              <strong>{formatMoney(cumulativeMaintenanceCost)}</strong>
              <small>本期 {formatMoney(calculation.maintenanceCost)} · {calculation.lines.filter((line) => line.quantity > 0).length} 个项目已录入数量</small>
            </div>

            <div className={`gross-result-panel ${getGrossTone(cumulativeGrossMarginRate)}`}>
              <span>毛利率</span>
              <strong>{formatPercent(cumulativeGrossMarginRate)}</strong>
              <small>{formatMoney(cumulativeGrossProfit)} 累计口径毛利额</small>
            </div>

            <div className="gross-result-grid">
              <MetricItem label="折前价格" value={formatMoney(calculation.originalPrice)} />
              <MetricItem label="折后价格" value={formatMoney(calculation.discountPrice)} />
              <MetricItem label="折扣率" value={formatPercent(calculation.discountRate)} />
              <MetricItem label="累计成本占折前" value={formatPercent(calculation.originalPrice ? cumulativeMaintenanceCost / calculation.originalPrice : 0)} />
            </div>

            <div className="gross-review-editor">
              <div className="gross-review-head">
                <span>最终审核文案</span>
              </div>
              <textarea
                value={visibleReviewText}
                onChange={(event) => {
                  setReviewDirty(true);
                  setReviewText(event.target.value);
                }}
              />
              <small>{reviewDirty ? "已手动微调，导出和历史会保存这版最终文案。" : "已自动跟随上方期数、比例、CPM 和数量实时变化。"}</small>
            </div>

            <div className="button-row gross-export-row">
              <button
                aria-label={`导出${phaseName || "当前期"}审核文案`}
                className="btn primary"
                onClick={() => void handleExportReview(phaseName || "本次")}
                type="button"
              >
                <Copy aria-hidden="true" size={15} />
                导出{phaseName || "当前期"}
              </button>
            </div>

          </div>
        </aside>
      </section>
    </div>
  );
}

function PriceGroup({
  config,
  items,
  locked,
  priceInputs,
  onPriceChange
}: {
  config: ServiceConfig;
  items: GrossMarginPriceOption[];
  locked: boolean;
  priceInputs: Record<string, string>;
  onPriceChange: (id: string, value: string) => void;
}) {
  if (items.length === 1) {
    const item = items[0];
    return (
      <section className="gross-price-group gross-price-group-compact">
        <label className="gross-price-option gross-price-option-single" key={item.id}>
          <h3>{config.label}</h3>
          <span className="gross-price-input">
            <input
              inputMode="decimal"
              min={0}
              type="number"
              disabled={locked}
              value={priceInputs[item.id] ?? String(item.unitPrice)}
              onChange={(event) => onPriceChange(item.id, event.target.value)}
              placeholder="0.00"
            />
            <small>{`元/${item.quantityUnit}`}</small>
          </span>
        </label>
      </section>
    );
  }

  return (
    <section className="gross-price-group">
      <div>
        <h3>{config.label}</h3>
      </div>
      <div className="gross-price-option-list">
        {items.map((item) => (
          <label className="gross-price-option" key={item.id}>
            <span>{item.name}</span>
            <span className="gross-price-input">
              <input
                inputMode="decimal"
                min={0}
                type="number"
                disabled={locked}
                value={priceInputs[item.id] ?? String(item.unitPrice)}
                onChange={(event) => onPriceChange(item.id, event.target.value)}
                placeholder="0.00"
              />
              <small>{`元/${item.quantityUnit}`}</small>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="metric-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function readMaintenanceRecords(): MaintenanceBaseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(maintenanceRecordStorageKey) || "[]") as MaintenanceBaseRecord[];
    return Array.isArray(parsed) ? dedupeMaintenanceRecords(parsed.map(normalizeMaintenanceRecord).filter(Boolean) as MaintenanceBaseRecord[]) : [];
  } catch {
    return [];
  }
}

function writeMaintenanceRecords(records: MaintenanceBaseRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(maintenanceRecordStorageKey, JSON.stringify(records.slice(0, 120)));
}

function readGroupConfigs(): GroupMaintenanceConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(groupConfigStorageKey) || "[]") as GroupMaintenanceConfig[];
    return Array.isArray(parsed) ? parsed.map(normalizeGroupConfig).filter(Boolean) as GroupMaintenanceConfig[] : [];
  } catch {
    return [];
  }
}

function writeGroupConfigs(configs: GroupMaintenanceConfig[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(groupConfigStorageKey, JSON.stringify(configs));
}

function normalizeGroupConfig(config: GroupMaintenanceConfig) {
  if (!config || typeof config !== "object") return null;
  return {
    groupName: String(config.groupName || "未分组"),
    preset: normalizeDouyinPreset(config.preset),
    priceInputs: config.priceInputs && typeof config.priceInputs === "object" ? config.priceInputs : {},
    updatedAt: String(config.updatedAt || new Date().toISOString())
  } satisfies GroupMaintenanceConfig;
}

function normalizeDouyinPreset(preset?: Partial<DouyinPresetConfig> | null): DouyinPresetConfig {
  return {
    basePlayWan: String(preset?.basePlayWan || defaultDouyinPreset.basePlayWan),
    like: String(preset?.like || defaultDouyinPreset.like),
    favorite: String(preset?.favorite || defaultDouyinPreset.favorite),
    share: String(preset?.share || defaultDouyinPreset.share),
    comment: String(preset?.comment || defaultDouyinPreset.comment)
  };
}

function getGroupConfig(configs: GroupMaintenanceConfig[], groupName: string): GroupMaintenanceConfig {
  const found = configs.find((config) => normalizeGroupName(config.groupName) === normalizeGroupName(groupName));
  return found || {
    groupName,
    preset: defaultDouyinPreset,
    priceInputs: {},
    updatedAt: new Date().toISOString()
  };
}

function upsertGroupConfig(
  configs: GroupMaintenanceConfig[],
  groupName: string,
  patch: Partial<Pick<GroupMaintenanceConfig, "preset" | "priceInputs">>
) {
  const existing = getGroupConfig(configs, groupName);
  const next = normalizeGroupConfig({
    ...existing,
    ...patch,
    groupName,
    updatedAt: new Date().toISOString()
  });
  if (!next) return configs;
  return [next, ...configs.filter((config) => normalizeGroupName(config.groupName) !== normalizeGroupName(groupName))];
}

function normalizeMaintenanceRecord(record: MaintenanceBaseRecord) {
  if (!record || typeof record !== "object") return null;
  return {
    id: String(record.id || `gm-${Date.now().toString(36)}`),
    groupName: String(record.groupName || "未分组"),
    targetName: String(record.targetName || legacyProjectName(record) || "未命名标的"),
    source: record.source === "traffic-plan" ? "traffic-plan" : undefined,
    sourceProjectId: String(record.sourceProjectId || ""),
    sourceAccountExecutionId: String(record.sourceAccountExecutionId || ""),
    platform: record.platform === "bilibili" ? "bilibili" : "douyin",
    accountName: String(record.accountName || ""),
    videoUrl: String(record.videoUrl || ""),
    originalPrice: String(record.originalPrice || ""),
    discountRate: String(record.discountRate || ""),
    discountPrice: String(record.discountPrice || ""),
    targetPlayWan: String(record.targetPlayWan || ""),
    targetCpm: String(record.targetCpm || "50"),
    phaseName: String(record.phaseName || "一期"),
    phaseRatio: String(record.phaseRatio || "50"),
    maintenanceCost: toAmount(record.maintenanceCost),
    exportedReviewText: String(record.exportedReviewText || ""),
    quantityInputs: { ...makeEmptyQuantityInputs(), ...(record.quantityInputs || {}) },
    selectedOptions: record.selectedOptions || {},
    archivedAt: typeof record.archivedAt === "string" && record.archivedAt ? record.archivedAt : undefined,
    createdAt: String(record.createdAt || new Date().toISOString()),
    updatedAt: String(record.updatedAt || record.createdAt || new Date().toISOString())
  } satisfies MaintenanceBaseRecord;
}

function legacyProjectName(record: MaintenanceBaseRecord) {
  const legacy = record as MaintenanceBaseRecord & { projectName?: unknown };
  return typeof legacy.projectName === "string" ? legacy.projectName : "";
}

function findExistingMaintenanceRecord(
  records: MaintenanceBaseRecord[],
  target: {
    activeRecordId: string;
    groupName: string;
    sourceAccountExecutionId: string;
    targetName: string;
    accountName: string;
    platform: PlatformKey;
    videoUrl: string;
    phaseName: string;
  }
) {
  const activeRecord = records.find((record) => record.id === target.activeRecordId);
  if (
    activeRecord &&
    normalizeProjectName(activeRecord.targetName) === normalizeProjectName(target.targetName) &&
    normalizePhaseName(activeRecord.phaseName) === normalizePhaseName(target.phaseName)
  ) {
    return activeRecord;
  }
  if (target.sourceAccountExecutionId.trim()) {
    const sourceMatched = records.find((record) =>
      normalizeRecordIdentity(record.sourceAccountExecutionId) === normalizeRecordIdentity(target.sourceAccountExecutionId) &&
      normalizePhaseName(record.phaseName) === normalizePhaseName(target.phaseName)
    );
    if (sourceMatched) return sourceMatched;
  }
  return records.find((record) =>
    normalizeGroupName(record.groupName) === normalizeGroupName(target.groupName) &&
    normalizeProjectName(record.targetName) === normalizeProjectName(target.targetName) &&
    normalizeRecordIdentity(record.accountName) === normalizeRecordIdentity(target.accountName) &&
    normalizeRecordIdentity(normalizeVideoUrlInput(record.videoUrl)) === normalizeRecordIdentity(normalizeVideoUrlInput(target.videoUrl)) &&
    record.platform === target.platform &&
    normalizePhaseName(record.phaseName) === normalizePhaseName(target.phaseName)
  );
}

function dedupeMaintenanceRecords(records: MaintenanceBaseRecord[]) {
  const byKey = new Map<string, MaintenanceBaseRecord>();
  for (const record of records) {
    const key = getMaintenanceRecordKey(record);
    const existing = byKey.get(key);
    if (!existing || +new Date(record.updatedAt) >= +new Date(existing.updatedAt)) {
      byKey.set(key, record);
    }
  }
  return [...byKey.values()].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

function getMaintenanceRecordKey(record: MaintenanceBaseRecord) {
  const archivedState = record.archivedAt ? "archived" : "active";
  const phase = normalizePhaseName(record.phaseName);
  const sourceExecutionId = normalizeRecordIdentity(record.sourceAccountExecutionId);
  if (sourceExecutionId) return [archivedState, "traffic", sourceExecutionId, phase].join(":");

  return [
    archivedState,
    "manual",
    normalizeGroupName(record.groupName),
    normalizeProjectName(record.targetName),
    record.platform,
    normalizeRecordIdentity(record.accountName),
    normalizeRecordIdentity(normalizeVideoUrlInput(record.videoUrl)),
    phase
  ].join(":");
}

function calculateCumulativeMaintenanceCost(
  records: MaintenanceBaseRecord[],
  target: { activeRecordId: string; currentCost: number; groupName: string; phaseName: string; targetName: string }
) {
  if (!target.targetName.trim()) return target.currentCost;
  const currentPhaseRank = phaseRank(target.phaseName);
  const previousCost = records
    .filter((record) => {
      if (record.id === target.activeRecordId && normalizePhaseName(record.phaseName) === normalizePhaseName(target.phaseName)) return false;
      if (normalizeGroupName(record.groupName) !== normalizeGroupName(target.groupName)) return false;
      if (normalizeProjectName(record.targetName) !== normalizeProjectName(target.targetName)) return false;
      return phaseRank(record.phaseName) <= currentPhaseRank;
    })
    .reduce((sum, record) => sum + calculateRecordMaintenanceCost(record), 0);
  return previousCost + target.currentCost;
}

function calculateRecordMaintenanceCost(record: MaintenanceBaseRecord) {
  return toAmount(record.maintenanceCost) || extractReviewCost(record.exportedReviewText);
}

function extractReviewCost(text: string) {
  const match = String(text || "").match(/(?:本期|一期|二期|三期|四期|五期|六期|第\d+期)?维护成本(?:预计)?[：:]([\d,.]+)元/);
  return toAmount((match?.[1] || "").replace(/,/g, ""));
}

function groupMaintenanceRecords(records: MaintenanceBaseRecord[]) {
  const groups = new Map<string, MaintenanceBaseRecord[]>();
  for (const record of records) {
    const key = record.groupName || "未分组";
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return [...groups.entries()].map(([name, groupRecords]) => ({
    name,
    records: groupRecords.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    projects: groupProjectRecords(groupRecords)
  }));
}

function groupProjectRecords(records: MaintenanceBaseRecord[]) {
  const projects = new Map<string, MaintenanceBaseRecord[]>();
  for (const record of records) {
    const key = record.targetName || "未命名项目";
    projects.set(key, [...(projects.get(key) || []), record]);
  }
  return [...projects.entries()]
    .map(([name, projectRecords]) => ({
      name,
      records: projectRecords.sort(compareMaintenancePhaseRecords)
    }))
    .sort((a, b) => +new Date(b.records[0]?.updatedAt || 0) - +new Date(a.records[0]?.updatedAt || 0));
}

function compareMaintenancePhaseRecords(a: MaintenanceBaseRecord, b: MaintenanceBaseRecord) {
  const phaseDiff = phaseRank(a.phaseName) - phaseRank(b.phaseName);
  if (phaseDiff) return phaseDiff;
  return +new Date(a.updatedAt) - +new Date(b.updatedAt);
}

function phaseRank(value: string) {
  if (/一/.test(value)) return 1;
  if (/二/.test(value)) return 2;
  if (/三/.test(value)) return 3;
  if (/四/.test(value)) return 4;
  const matched = value.match(/\d+/);
  return matched ? Number(matched[0]) : 99;
}

function normalizeProjectName(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function normalizePhaseName(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function normalizeRecordIdentity(value?: string) {
  return (value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function getUserGroupName(user: HostAuthUser | null) {
  const candidates = [
    user?.group_name,
    user?.display_name,
    user?.real_name,
    user?.username,
    user?.title,
    user?.role
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const matchedGroup = candidates.map(formatContentGroupName).find((value) => value !== "未分组");
  return matchedGroup || findGroupByMemberName(candidates) || "未分组";
}

function formatContentGroupName(value: string) {
  const normalized = value.trim();
  const numericMatch = normalized.match(/(?:内容)?\s*([1-9]\d*)\s*组/);
  if (numericMatch) return `内容${numericMatch[1]}组`;
  const chineseMatch = normalized.match(/(?:内容)?\s*([一二三四五六七八九十])\s*组/);
  if (chineseMatch) return `内容${chineseMatch[1]}组`;
  return "未分组";
}

function findGroupByMemberName(candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizePersonName).filter(Boolean);
  for (const group of contentGroupMembers) {
    if (group.members.some((member) => normalizedCandidates.includes(normalizePersonName(member)))) {
      return group.groupName;
    }
  }
  return "";
}

function normalizePersonName(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function buildDouyinPresetQuantities(playWan: number, preset: DouyinPresetConfig) {
  const basePlayWan = Math.max(toQuantityAmount(preset.basePlayWan, "万"), 1);
  const factor = playWan / basePlayWan;
  return {
    playWan: roundUpTo(playWan, 5),
    like: roundUpTo(toQuantityAmount(preset.like) * factor, 1000),
    favorite: roundUpTo(toQuantityAmount(preset.favorite) * factor, 50),
    share: roundUpTo(toQuantityAmount(preset.share) * factor, 50),
    comment: roundUpTo(toQuantityAmount(preset.comment) * factor, 50)
  };
}

function roundUpTo(value: number, step: number) {
  if (value <= 0) return 0;
  return Math.ceil(value / step) * step;
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function getSelectedServiceUnits(
  table: GrossMarginPriceTable | null,
  selectedOptions: Partial<Record<GrossMarginServiceKind, string>>
) {
  return Object.fromEntries(
    serviceConfigs.map((config) => {
      const options = table ? getServiceOptions(table, config.service) : [];
      return [config.service, getSelectedOption(options, selectedOptions[config.service])?.quantityUnit || "个"];
    })
  ) as Record<GrossMarginServiceKind, string>;
}

function inferPhaseRatioFromPlayInput(
  value: string,
  context: {
    playWan: number;
    preset: DouyinPresetConfig;
    selectedOptions: Partial<Record<GrossMarginServiceKind, string>>;
    table: GrossMarginPriceTable | null;
  }
) {
  if (context.playWan <= 0) return "custom";
  const optionUnits = getSelectedServiceUnits(context.table, context.selectedOptions);
  const actualPlayWan = toQuantityAmount(value, optionUnits.play) / 10000;
  if (actualPlayWan <= 0) return "custom";
  const matched = phaseRatioOptions.find((option) => {
    const ratio = toAmount(option) / 100;
    const preset = buildDouyinPresetQuantities(context.playWan * ratio, context.preset);
    return Math.abs(preset.playWan - actualPlayWan) < 0.000001;
  });
  return matched || "custom";
}

function findDouyinLowQualityPlayOption(table: GrossMarginPriceTable | null) {
  if (table?.platform !== "douyin") return null;
  return (
    table.items.find((item) => item.id === "douyin-play-qianchuan-10w") ||
    table.items.find((item) => item.service === "play" && /低质千川/.test(item.name)) ||
    null
  );
}

function resolvePresetPlayWan(playWan: string, discountPrice: string, originalPrice: string, cpm: string) {
  const price = toAmount(discountPrice) || toAmount(originalPrice);
  const cpmValue = toAmount(cpm);
  if (price > 0 && cpmValue > 0) return price / cpmValue / 10;
  return toAmount(playWan);
}

function formatPresetQuantity(value: number, quantityUnit?: string) {
  if (quantityUnit === "万") return formatAmountInput(value / 10000);
  if (quantityUnit === "千") return formatAmountInput(value / 1000);
  return formatAmountInput(value);
}

function formatPresetPlayQuantity(playWan: number, quantityUnit?: string) {
  if (quantityUnit === "万") return formatAmountInput(playWan);
  if (quantityUnit === "千") return formatAmountInput(playWan * 10);
  return formatAmountInput(playWan * 10000);
}

function estimateCpmBudget(playWan: string, cpm: string) {
  return toAmount(playWan) * 10000 / 1000 * toAmount(cpm);
}

function normalizeVideoUrlInput(value: string) {
  const trimmed = value.trim();
  const url = trimmed.match(/https?:\/\/[^\s，。；;、)）\]]+/i)?.[0] || "";
  return (url || trimmed).replace(/[，。；;,.)）\]]+$/g, "");
}

function formatRecordDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(+date)) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatPhaseRatio(value: string) {
  return value === "custom" ? "自定义" : `${value || 100}%`;
}

function calculateGrossMargin({
  configs,
  discountPrice,
  originalPrice,
  priceInputs,
  quantityInputs,
  selectedOptions,
  table
}: {
  configs: ServiceConfig[];
  discountPrice: number;
  originalPrice: number;
  priceInputs: Record<string, string>;
  quantityInputs: Record<GrossMarginServiceKind, string>;
  selectedOptions: Partial<Record<GrossMarginServiceKind, string>>;
  table: GrossMarginPriceTable | null;
}): GrossMarginCalculationResult {
  const lines: GrossMarginCalculationLine[] = configs.map((config) => {
    const options = table ? getServiceOptions(table, config.service) : [];
    const option = getSelectedOption(options, selectedOptions[config.service]);
    const unitPrice = option ? toAmount(priceInputs[option.id] ?? option.unitPrice) : 0;
    const quantity = toQuantityAmount(quantityInputs[config.service], option?.quantityUnit);
    return {
      service: config.service,
      label: config.label,
      optionId: option?.id || "",
      optionName: option?.name || "",
      quantity,
      unitPrice,
      quantityUnit: option?.quantityUnit || "个",
      total: quantity * unitPrice
    };
  });
  const maintenanceCost = lines.reduce((sum, line) => sum + line.total, 0);
  const grossProfit = discountPrice - maintenanceCost;

  return {
    originalPrice,
    discountPrice,
    maintenanceCost,
    grossProfit,
    grossMarginRate: originalPrice > 0 ? grossProfit / originalPrice : 0,
    discountRate: originalPrice > 0 ? discountPrice / originalPrice : 0,
    lines
  };
}

function makePriceInputs(table: GrossMarginPriceTable) {
  return Object.fromEntries(table.items.map((item) => [item.id, String(item.unitPrice)]));
}

function makeEmptyQuantityInputs(): Record<GrossMarginServiceKind, string> {
  return {
    play: "",
    like: "",
    douPlus: "",
    coin: "",
    comment: "",
    share: "",
    favorite: "",
    danmaku: "",
    blueLink: ""
  };
}

function makeDefaultSelections(table: GrossMarginPriceTable) {
  return Object.fromEntries(
    serviceConfigs.map((config) => [config.service, getServiceOptions(table, config.service)[0]?.id || ""])
  ) as Partial<Record<GrossMarginServiceKind, string>>;
}

function getServiceOptions(table: GrossMarginPriceTable, service: GrossMarginServiceKind) {
  return table.items.filter((item) => item.service === service);
}

function getSelectedOption(options: GrossMarginPriceOption[], selectedId?: string) {
  return options.find((option) => option.id === selectedId) || options[0] || null;
}

function findGrossMarginAccount(accounts: GrossMarginAccountPrice[], rawName: string) {
  const name = normalizeAccountName(rawName);
  if (!name) return null;
  return (
    accounts.find((account) => normalizeAccountName(account.name) === name) ||
    accounts.find((account) => normalizeAccountName(account.name).includes(name) || name.includes(normalizeAccountName(account.name))) ||
    null
  );
}

function normalizeAccountName(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function formatTypeOptionName(name: string) {
  return name.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function getMinimumQuantityWarning(option: GrossMarginPriceOption | null, rawQuantity: string, quantity: number) {
  if (!option?.minimumQuantity) return "";
  if (!rawQuantity.trim()) return "";
  if (quantity >= option.minimumQuantity) return "";
  return `未达起量，至少 ${formatThreshold(option.minimumQuantity)}${option.quantityUnit}`;
}

function formatThreshold(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  });
}

function buildGrossMarginReview({
  account,
  accountName,
  calculation,
  cumulativeCost,
  platform,
  phaseName,
  videoUrl
}: {
  account: GrossMarginAccountPrice | null;
  accountName: string;
  calculation: GrossMarginCalculationResult;
  cumulativeCost: number;
  platform: PlatformKey;
  phaseName: string;
  videoUrl: string;
}) {
  const lines = new Map(calculation.lines.map((line) => [line.service, line]));
  const displayName = account?.name || accountName.trim();
  const displayVideoUrl = videoUrl.trim();
  const cumulativeGrossMarginRate = calculation.originalPrice > 0
    ? (calculation.discountPrice - cumulativeCost) / calculation.originalPrice
    : 0;
  const reviewFooter = "@罗娜 @姚琳琳(Lin.) @罗雪莲 @翁林湑(空白) @罗月琴 辛苦审核";

  if (platform === "bilibili") {
    return [
      "【B站】",
      `账号：${displayName}`,
      `视频链接：${displayVideoUrl}`,
      `播放量（${formatBilibiliPlayChannel(lines.get("play"))}）：${formatReviewMetricValue(lines.get("play"), platform)}`,
      `点赞：${formatReviewMetricValue(lines.get("like"), platform)}`,
      `投币：${formatReviewMetricValue(lines.get("coin"), platform)}`,
      `收藏：${formatReviewMetricValue(lines.get("favorite"), platform)}`,
      `评论：${formatReviewMetricValue(lines.get("comment"), platform)}`,
      `分享：${formatReviewMetricValue(lines.get("share"), platform)}`,
      `弹幕：${formatReviewMetricValue(lines.get("danmaku"), platform)}`,
      `蓝链点击：${formatReviewMetricValue(lines.get("blueLink"), platform)}`,
      `${phaseName || "本期"}维护成本：${formatReviewMoney(calculation.maintenanceCost)}元`,
      `累计维护成本：${formatReviewMoney(cumulativeCost)}元`,
      `维护后毛利率：${formatReviewPercent(cumulativeGrossMarginRate)}`,
      reviewFooter
    ].join("\n");
  }

  return [
    "【抖音】",
    `账号：${displayName}`,
    `抖音ID：${account?.douyinId || ""}`,
    `合作码：${account?.cooperationCode || ""}`,
    `视频链接：${displayVideoUrl}`,
    `播放量${formatReviewLabelSuffix(lines.get("play"))}：${formatReviewMetricValue(lines.get("play"), platform)}`,
    `点赞${formatReviewLabelSuffix(lines.get("like"))}：${formatReviewMetricValue(lines.get("like"), platform)}`,
    `评论${formatReviewLabelSuffix(lines.get("comment"))}：${formatReviewMetricValue(lines.get("comment"), platform)}`,
    `收藏：${formatReviewMetricValue(lines.get("favorite"), platform)}`,
    `转发：${formatReviewMetricValue(lines.get("share"), platform)}`,
    `抖加：${formatReviewMetricValue(lines.get("douPlus"), platform)}`,
    `${phaseName || "本期"}维护成本：${formatReviewMoney(calculation.maintenanceCost)}元`,
    `累计维护成本：${formatReviewMoney(cumulativeCost)}元`,
    `维护后毛利率：${formatReviewPercent(cumulativeGrossMarginRate)}`,
    reviewFooter
  ].join("\n");
}

function formatReviewLabelSuffix(line?: GrossMarginCalculationLine) {
  const name = formatTypeOptionName(line?.optionName || "");
  return name ? `（${name}）` : "";
}

function formatBilibiliPlayChannel(line?: GrossMarginCalculationLine) {
  if (!line?.optionId) return "正常通道";
  if (line.optionId.includes("play-fast")) return "快速通道";
  return "正常通道";
}

function formatReviewMetricValue(line: GrossMarginCalculationLine | undefined, platform: PlatformKey) {
  if (!line || line.quantity <= 0) return "/";
  if (line.service === "douPlus") return `${formatReviewMoney(line.quantity)}元`;
  if (line.quantityUnit === "万") {
    return `${formatThreshold(line.quantity)}${platform === "bilibili" ? "W" : "万"}`;
  }
  if (line.quantityUnit === "千") {
    return formatReviewNumber(line.quantity * 1000);
  }
  return formatReviewNumber(line.quantity);
}

function formatReviewNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function formatReviewMoney(value: number) {
  if (Math.abs(value - Math.round(value)) < 0.000001) {
    return String(Math.round(value));
  }
  return value.toFixed(2);
}

function formatReviewPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function toAmount(value: string | number | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toQuantityAmount(value: string | number | undefined, quantityUnit?: string) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "").trim().replace(/,/g, "");
  if (!normalized) return 0;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([wWkK万千]?)$/);
  if (!match) return toAmount(normalized);
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  const suffix = match[2];
  if (/[wW万]/.test(suffix)) {
    if (quantityUnit === "万") return amount;
    if (quantityUnit === "千") return amount * 10;
    return amount * 10000;
  }
  if (/[kK千]/.test(suffix)) {
    if (quantityUnit === "万") return amount / 10;
    if (quantityUnit === "千") return amount;
    return amount * 1000;
  }
  return amount;
}

function formatAmountInput(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 0.000001) return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function formatMoney(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `¥${safeValue.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatUnitPrice(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `¥${safeValue.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPercent(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${(safeValue * 100).toFixed(2)}%`;
}

function formatPlatform(value: PlatformKey) {
  return value === "douyin" ? "抖音" : "B站";
}

function getGrossTone(value: number) {
  if (value < 0) return "negative";
  if (value < 0.15) return "warning";
  return "positive";
}

function describeQuantityInput(quantityUnit?: string) {
  if (quantityUnit === "万") return "数量直接填万，不用自己换算";
  if (quantityUnit === "千") return "数量直接填千，不用自己换算";
  return "数量直接填个数";
}
