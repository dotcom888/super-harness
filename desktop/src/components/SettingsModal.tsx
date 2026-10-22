import React, { useState, useEffect } from "react";
import {
  X,
  RefreshCw,
  Download, 
  Settings, 
  Cpu, 
  ShieldCheck, 
  Zap, 
  FileEdit, 
  Compass, 
  Info, 
  Plus, 
  Check, 
  Layers,
  Sparkles,
  Type,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Edit2,
  Trash2,
  RotateCw,
  ChevronDown
} from "lucide-react";
import { ModelProvider } from "../types";
import { ConfirmModal } from "./ConfirmModal";
import { LOGO_DATA_URI } from "../assets/logoData";
import { useModalTransition } from "../utils/useModalTransition";
import { ModalTransition } from "./ModalTransition";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
  onSaveModel: (m: string) => void;
  onProvidersUpdated?: (providers: ModelProvider[], activeModels: string[]) => void;
  theme?: "light" | "dark";
  onSelectTheme?: (theme: "light" | "dark") => void;
  fontSizeLevel?: number;
  onSelectFontSize?: (level: number) => void;
  initialTab?: "models" | "security" | "general" | "about";
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentModel,
  onSaveModel,
  onProvidersUpdated,
  theme = "light",
  onSelectTheme,
  fontSizeLevel = 1,
  onSelectFontSize,
  initialTab = "models"
}) => {
  const [activeTab, setActiveTab] = useState<"models" | "security" | "general" | "about">("models");
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  // 提供方配置弹窗状态
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelProvider | null>(null);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [pendingDeleteProviderId, setPendingDeleteProviderId] = useState<string | null>(null);

  // 单个模型映射操作状态 (对标需求：编辑、测试连接、删除)
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [editingModelName, setEditingModelName] = useState<string | null>(null);
  const [editingModelInput, setEditingModelInput] = useState("");
  const [testingModelName, setTestingModelName] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [pendingDeleteModel, setPendingDeleteModel] = useState<{ provider: ModelProvider; model: string } | null>(null);

  // 版本检测状态
  const [checkVersionStatus, setCheckVersionStatus] = useState<"idle" | "checking" | "latest" | "has_update" | "error">("idle");
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [releaseUrl, setReleaseUrl] = useState<string>("https://github.com/dotcom888/super-harness/releases");
  const [downloadAssetUrl, setDownloadAssetUrl] = useState<string>("");
  const [updateNote, setUpdateNote] = useState<string>("");

  useEffect(() => {
    if (isOpen && activeTab === "about") {
      handleCheckVersion();
    }
  }, [isOpen, activeTab]);

  const handleCheckVersion = async () => {
    setCheckVersionStatus("checking");
    const startTime = Date.now();
    try {
      const res = await fetch("https://api.github.com/repos/dotcom888/super-harness/releases/latest", {
        headers: { Accept: "application/vnd.github.v3+json" }
      });
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      const data = await res.json();
      const tag = (data.tag_name || data.name || "").trim();
      const currentVer = "v5.7.16";
      setLatestVersion(tag || "未知");
      const htmlUrl = data.html_url || "https://github.com/dotcom888/super-harness/releases";
      setReleaseUrl(htmlUrl);
      setUpdateNote(data.body ? data.body.slice(0, 180) : "");

      const exeAsset = (data.assets || []).find((a: any) =>
        a.name && (a.name.endsWith(".exe") || a.name.endsWith(".zip"))
      );
      if (exeAsset) {
        setDownloadAssetUrl(exeAsset.browser_download_url);
      } else {
        setDownloadAssetUrl(htmlUrl);
      }

      const cleanTag = tag.replace(/^v/i, "");
      const cleanCurrent = currentVer.replace(/^v/i, "");

      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((r) => setTimeout(r, 500 - elapsed));
      }

      if (cleanTag === cleanCurrent || !cleanTag) {
        setCheckVersionStatus("latest");
      } else {
        setCheckVersionStatus("has_update");
      }
    } catch (e) {
      setCheckVersionStatus("error");
    }
  };

  const handleOpenRelease = (url?: string) => {
    const target = url || downloadAssetUrl || releaseUrl;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.openExternal) {
      electronAPI.openExternal(target);
    } else {
      window.open(target, "_blank");
    }
  };

  // 编辑提供方表单字段
  const [formName, setFormName] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModelList, setFormModelList] = useState<string[]>([""]);
  const [modalFetchedModels, setModalFetchedModels] = useState<string[]>([]);
  const [isFetchingModalModels, setIsFetchingModalModels] = useState(false);
  const [modalFetchError, setModalFetchError] = useState("");
  const [modalFetchSuccess, setModalFetchSuccess] = useState("");

  // 右侧内联添加模型状态与拉取
  const [inlineFetchedModels, setInlineFetchedModels] = useState<string[]>([]);
  const [isFetchingInlineModels, setIsFetchingInlineModels] = useState(false);
  const [inlineFetchError, setInlineFetchError] = useState("");
  const [inlineFetchSuccess, setInlineFetchSuccess] = useState("");
  const [formProtocol, setFormProtocol] = useState<string>("openai_chat");
  const [isFormCustom, setIsFormCustom] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [validationError, setValidationError] = useState("");
  const [saveSuccessMsg, setSaveSuccessMsg] = useState("");

  const fetchProviders = () => {
    fetch("http://127.0.0.1:8765/api/models/providers")
      .then((res) => res.json())
      .then((data) => {
        if (data.providers) {
          setProviders(data.providers);
          // 保证始终有高亮选中的提供方
          setSelectedProviderId((prev) => {
            if (prev && data.providers.some((p: ModelProvider) => (p.id || p.name) === prev)) {
              return prev;
            }
            return data.providers.length > 0 ? (data.providers[0].id || data.providers[0].name) : null;
          });
          // 若当前正在编辑的提供方已不在最新列表中，自动收起表单
          setEditingProvider((prev) => {
            if (!prev) return null;
            const exists = (data.providers as ModelProvider[]).some(
              (p: ModelProvider) => p.id === prev.id || p.name === prev.name
            );
            return exists ? prev : null;
          });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchProviders();
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    setInlineFetchedModels([]);
    setInlineFetchError("");
    setInlineFetchSuccess("");
    setIsAddingModel(false);
    setEditingModelName(null);
  }, [selectedProviderId]);

  const { mounted, visible } = useModalTransition(isOpen, 300);

  if (!mounted) return null;

  // 当前激活选中的提供方对象
  const selectedProvider = providers.find((p) => (p.id || p.name) === selectedProviderId) || providers[0] || null;

  // 打开提供方编辑弹窗
  const handleOpenEdit = (p: ModelProvider) => {
    setEditingProvider(p);
    setFormName(p.name);
    setFormBaseUrl(p.base_url);
    setFormApiKey(p.api_key || "");
    setFormModelList(p.models && p.models.length > 0 ? [...p.models] : [""]);
    setModalFetchedModels([]);
    setIsFetchingModalModels(false);
    setModalFetchError("");
    setModalFetchSuccess("");
    setFormProtocol(p.protocol || "openai_chat");
    setIsFormCustom(Boolean(p.is_custom));
    setIsAddingCustom(false);
    setShowApiKey(false);
    setTestResult(null);
    setValidationError("");
    setSaveSuccessMsg("");
    setIsProviderModalOpen(true);
  };

  // 打开提供方新增弹窗
  const handleOpenAdd = () => {
    setEditingProvider(null);
    setIsAddingCustom(true);
    setFormName("");
    setFormBaseUrl("");
    setFormApiKey("");
    setFormModelList([""]);
    setModalFetchedModels([]);
    setIsFetchingModalModels(false);
    setModalFetchError("");
    setModalFetchSuccess("");
    setFormProtocol("openai_chat");
    setIsFormCustom(true);
    setShowApiKey(false);
    setTestResult(null);
    setValidationError("");
    setSaveSuccessMsg("");
    setIsProviderModalOpen(true);
  };

  // 连通性测试 (测试提供方通用)
  // 弹窗内获取远程模型列表 (满足需求2)
  const handleFetchModalRemoteModels = async () => {
    const trimmedUrl = formBaseUrl.trim().replace(/\/+$/, "");
    const trimmedKey = formApiKey.trim();
    if (!trimmedUrl) {
      setModalFetchError("请先填写接口地址 (Base URL)");
      setModalFetchSuccess("");
      return;
    }
    if (!trimmedKey) {
      setModalFetchError("请先填写 API 密钥 (API Key)");
      setModalFetchSuccess("");
      return;
    }

    setIsFetchingModalModels(true);
    setModalFetchError("");
    setModalFetchSuccess("");

    try {
      const res = await fetch("http://127.0.0.1:8765/api/models/fetch-remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: trimmedUrl,
          api_key: trimmedKey,
          protocol: formProtocol
        })
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.models)) {
        setModalFetchedModels(data.models);
        setModalFetchSuccess(`已成功获取 ${data.models.length} 个可用模型`);
        // 若当前列表只有一项且为空，自动填入第一项
        setFormModelList((prev) => {
          if (prev.length === 1 && !prev[0] && data.models.length > 0) {
            return [data.models[0]];
          }
          return prev;
        });
      } else {
        setModalFetchError(data.error || "获取模型列表失败，请核对地址与密钥");
      }
    } catch (err: any) {
      setModalFetchError("网络异常，无法获取模型列表: " + err.message);
    } finally {
      setIsFetchingModalModels(false);
    }
  };

  // 右侧内联添加卡片获取远程模型列表 (满足需求3)
  const handleFetchInlineRemoteModels = async () => {
    if (!selectedProvider) return;
    const trimmedUrl = (selectedProvider.base_url || "").trim().replace(/\/+$/, "");
    const trimmedKey = (selectedProvider.api_key || "").trim();
    if (!trimmedUrl || !trimmedKey) {
      setInlineFetchError("该提供方未配置有效的基础地址或 API 密钥");
      return;
    }

    setIsFetchingInlineModels(true);
    setInlineFetchError("");
    setInlineFetchSuccess("");

    try {
      const res = await fetch("http://127.0.0.1:8765/api/models/fetch-remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: trimmedUrl,
          api_key: trimmedKey,
          protocol: selectedProvider.protocol || "openai_chat"
        })
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.models)) {
        setInlineFetchedModels(data.models);
        setInlineFetchSuccess(`已获取 ${data.models.length} 个可用模型`);
        if (!newModelName && data.models.length > 0) {
          setNewModelName(data.models[0]);
        }
      } else {
        setInlineFetchError(data.error || "获取模型列表失败");
      }
    } catch (err: any) {
      setInlineFetchError("网络请求异常: " + err.message);
    } finally {
      setIsFetchingInlineModels(false);
    }
  };

  // 连通性测试 (针对提供方通用)
  const handleTestConnection = async () => {
    setValidationError("");
    const trimmedUrl = formBaseUrl.trim().replace(/\/+$/, "");
    const trimmedKey = formApiKey.trim();
    if (!trimmedUrl) {
      setValidationError("请先填写接口地址 (Base URL)");
      return;
    }
    if (!trimmedKey) {
      setValidationError("请先填写 API 密钥 (API Key)");
      return;
    }

    const firstModel = formModelList.map(m => m.trim()).filter(Boolean)[0] || "";

    setIsTesting(true);
    setTestResult(null);

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch("http://127.0.0.1:8765/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: trimmedUrl,
          api_key: trimmedKey,
          model: firstModel || undefined,
          protocol: formProtocol
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutTimer);
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ success: true, message: data.message || "接口连通正常，鉴权通过！" });
      } else {
        setTestResult({ success: false, message: data.error || data.detail || "连接失败，请检查 Base URL 与 API Key" });
      }
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (err.name === "AbortError") {
        setTestResult({ success: false, message: "测试连接超时（超过 10 秒无响应），请检查上游代理服务与网络连通性。" });
      } else {
        setTestResult({ success: false, message: "请求服务失败: " + err.message });
      }
    } finally {
      setIsTesting(false);
    }
  };

  // 保存提供方基本信息
  const handleSaveProviderForm = () => {
    setValidationError("");
    setSaveSuccessMsg("");

    const name = formName.trim();
    const baseUrl = formBaseUrl.trim().replace(/\/+$/, "");
    const apiKey = formApiKey.trim();
    const modelsList = formModelList
      .map((m) => m.trim())
      .filter(Boolean);

    if (!name) {
      setValidationError("请填写提供方名称（例如: DeepSeek）");
      return;
    }
    if (!baseUrl) {
      setValidationError("请填写接口地址 Base URL（例如: https://api.deepseek.com/v1）");
      return;
    }
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      setValidationError("接口地址格式无效，必须以 http:// 或 https:// 开头");
      return;
    }
    if (!apiKey) {
      setValidationError("请填写 API 密钥 (API Key)");
      return;
    }

    const payload = {
      id: editingProvider ? editingProvider.id : undefined,
      name: name,
      base_url: baseUrl,
      api_key: apiKey,
      models: modelsList,
      protocol: formProtocol,
      is_custom: isFormCustom
    };

    fetch("http://127.0.0.1:8765/api/models/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSaveSuccessMsg("保存成功！已更新提供方并同步模型。");
          fetchProviders();
          if (onProvidersUpdated) {
            onProvidersUpdated(data.providers, data.active_models);
          }
          setSelectedProviderId(payload.id || payload.name);
          setTimeout(() => {
            setIsProviderModalOpen(false);
            setEditingProvider(null);
            setIsAddingCustom(false);
            setSaveSuccessMsg("");
          }, 600);
        }
      })
      .catch((err) => {
        setValidationError("保存提供方失败: " + err.message);
      });
  };

  // 更新当前提供方的映射模型列表核心方法
  const updateProviderModels = async (provider: ModelProvider, newModels: string[]) => {
    const payload = {
      id: provider.id,
      name: provider.name,
      base_url: provider.base_url,
      api_key: provider.api_key || "",
      models: newModels,
      protocol: provider.protocol || "openai_chat",
      is_custom: provider.is_custom
    };

    try {
      const res = await fetch("http://127.0.0.1:8765/api/models/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        fetchProviders();
        if (onProvidersUpdated) {
          onProvidersUpdated(data.providers, data.active_models);
        }
        return true;
      }
    } catch (err) {
      console.error("更新模型映射列表失败:", err);
    }
    return false;
  };

  // 1. 添加单个模型映射
  const handleConfirmAddModel = async () => {
    if (!selectedProvider) return;
    const trimmed = newModelName.trim();
    if (!trimmed) return;
    const existing = selectedProvider.models || [];
    if (existing.includes(trimmed)) {
      setIsAddingModel(false);
      setNewModelName("");
      return;
    }
    const updated = [...existing, trimmed];
    await updateProviderModels(selectedProvider, updated);
    setIsAddingModel(false);
    setNewModelName("");
  };

  // 2. 编辑单个模型映射名称
  const handleSaveEditModel = async () => {
    if (!selectedProvider || !editingModelName) return;
    const trimmed = editingModelInput.trim();
    if (!trimmed || trimmed === editingModelName) {
      setEditingModelName(null);
      return;
    }
    const existing = selectedProvider.models || [];
    const updated = existing.map((m) => (m === editingModelName ? trimmed : m));
    await updateProviderModels(selectedProvider, updated);
    if (currentModel === editingModelName) {
      onSaveModel(trimmed);
    }
    setEditingModelName(null);
  };

  // 3. 测试单个具体模型的连通性 (对标需求：测试连接按钮)
  const handleTestSingleModel = async (provider: ModelProvider, modelName: string) => {
    setTestingModelName(modelName);
    setModelTestResults((prev) => {
      const next = { ...prev };
      delete next[modelName];
      return next;
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch("http://127.0.0.1:8765/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: provider.base_url,
          api_key: provider.api_key || "",
          model: modelName,
          protocol: provider.protocol || "openai_chat"
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await res.json();
      if (res.ok && data.success) {
        setModelTestResults((prev) => ({
          ...prev,
          [modelName]: { success: true, message: data.message || "连接成功！模型调用正常响应。" }
        }));
      } else {
        setModelTestResults((prev) => ({
          ...prev,
          [modelName]: { success: false, message: data.error || data.detail || "调用失败，请检查 API 密钥或模型标识符是否有效。" }
        }));
      }
    } catch (err: any) {
      clearTimeout(timer);
      const msg = err.name === "AbortError" ? "测试连接超时（超过 12 秒无响应）" : ("请求异常: " + err.message);
      setModelTestResults((prev) => ({
        ...prev,
        [modelName]: { success: false, message: msg }
      }));
    } finally {
      setTestingModelName(null);
    }
  };

  // 4. 删除单个模型映射
  const handlePromptDeleteModel = (provider: ModelProvider, model: string) => {
    setPendingDeleteModel({ provider, model });
  };

  const handleConfirmDeleteModel = async () => {
    if (!pendingDeleteModel) return;
    const { provider, model } = pendingDeleteModel;
    setPendingDeleteModel(null);
    const existing = provider.models || [];
    const updated = existing.filter((m) => m !== model);
    await updateProviderModels(provider, updated);
    if (currentModel === model) {
      onSaveModel(updated[0] || "");
    }
  };

  // 删除提供方
  const handleDeleteProvider = (id: string) => {
    setPendingDeleteProviderId(id);
  };

  const handleConfirmDeleteProvider = () => {
    if (!pendingDeleteProviderId) return;
    const id = pendingDeleteProviderId;
    setPendingDeleteProviderId(null);

    if (editingProvider && (editingProvider.id === id || editingProvider.name === id)) {
      setEditingProvider(null);
      setIsAddingCustom(false);
      setIsProviderModalOpen(false);
      setValidationError("");
      setSaveSuccessMsg("");
    }

    if (selectedProviderId === id) {
      const remaining = providers.filter((p) => (p.id || p.name) !== id);
      setSelectedProviderId(remaining[0] ? (remaining[0].id || remaining[0].name) : null);
    }

    fetch(`http://127.0.0.1:8765/api/models/providers/${id}`, {
      method: "DELETE"
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          fetchProviders();
          if (onProvidersUpdated) {
            onProvidersUpdated(data.providers, data.active_models);
          }
        }
      })
      .catch(() => {});
  };

  return (
    <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} className={`fixed inset-0 z-[100] bg-black/50 backdrop-blur-xs flex items-center justify-center p-2 sm:p-3 transition-opacity duration-300 ease-out ${visible ? "opacity-100" : "opacity-0"} ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
      {/* 点击遮罩空白区域亦可快速平滑关闭弹窗 */}
      <div className="absolute inset-0" onClick={onClose} />
      {/* 左右结构主容器：提供宽适的 960px 宽度以完美容纳分栏 */}
      <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} onClick={(e) => e.stopPropagation()} className={`relative z-10 w-[96vw] max-w-[960px] h-[88vh] max-h-[850px] bg-white dark:bg-[#12141c] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#222634] overflow-hidden flex flex-row select-none transition-all duration-300 ease-out ${visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2"}`}>
        {/* 1. 最左侧系统导航边栏 (固定宽度 w-44) */}
        <aside className="w-44 h-full bg-[#f8f9fa] dark:bg-[#0d0f15] border-r border-gray-200/80 dark:border-[#1e222f] flex flex-col justify-between p-3 shrink-0 transition-colors">
          <div>
            {/* 左上角标题与 Logo */}
            <div className="flex items-center gap-2.5 px-3 py-3 mb-3 border-b border-gray-200/60 dark:border-[#1e222f]">
              <img src={LOGO_DATA_URI} alt="super logo" className="w-5 h-5 object-contain" />
              <div className="font-bold text-gray-900 dark:text-white text-sm tracking-tight">系统设置</div>
            </div>

            {/* 垂直导航菜单项 */}
            <nav className="space-y-1.5">
              <button
                type="button"
                onClick={() => { setActiveTab("models"); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  activeTab === "models"
                    ? "bg-white dark:bg-[#1a1d27] text-blue-600 dark:text-blue-400 shadow-xs font-semibold border border-transparent dark:border-[#2b3042]"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-[#161822] hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <Cpu size={16} className={activeTab === "models" ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"} />
                <span>模型提供方</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("security"); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  activeTab === "security"
                    ? "bg-white dark:bg-[#1a1d27] text-blue-600 dark:text-blue-400 shadow-xs font-semibold border border-transparent dark:border-[#2b3042]"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-[#161822] hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <ShieldCheck size={16} className={activeTab === "security" ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"} />
                <span>安全与模式</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("general"); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  activeTab === "general"
                    ? "bg-white dark:bg-[#1a1d27] text-blue-600 dark:text-blue-400 shadow-xs font-semibold border border-transparent dark:border-[#2b3042]"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-[#161822] hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <Settings size={16} className={activeTab === "general" ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"} />
                <span>通用设置</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("about"); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  activeTab === "about"
                    ? "bg-white dark:bg-[#1a1d27] text-blue-600 dark:text-blue-400 shadow-xs font-semibold border border-transparent dark:border-[#2b3042]"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-[#161822] hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <Info size={16} className={activeTab === "about" ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"} />
                <span>关于 super</span>
              </button>
            </nav>
          </div>
        </aside>

        {/* 2. 右侧主设置视口区 (自适应宽度，支持左右分栏与全屏展开) */}
        <main className="flex-1 h-full flex flex-col min-w-0 bg-white dark:bg-[#12141c] transition-colors">
          {/* 右侧顶部栏 */}
          <div className="h-12 border-b border-gray-100 dark:border-[#1e222f] flex items-center justify-between px-6 shrink-0">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {activeTab === "models" && "Model Providers Configuration"}
              {activeTab === "security" && "Security & Approval Policy"}
              {activeTab === "general" && "General Settings & Preferences"}
              {activeTab === "about" && "About super HARNESS Desktop"}
            </span>
            <button 
              type="button"
              onClick={onClose}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              className="relative z-50 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 rounded-xl transition cursor-pointer hover:bg-gray-100 dark:hover:bg-[#20222f] titlebar-no-drag"
              title="关闭设置"
            >
              <X size={18} />
            </button>
          </div>

          {/* 右侧主配置内容 */}
          <div className={`flex-1 min-h-0 ${activeTab === "models" ? "p-5 flex flex-col overflow-hidden" : "p-7 overflow-y-auto"}`}>
            {activeTab === "models" && (
              <div className="flex flex-col h-full min-h-0 overflow-hidden">
                {/* 顶栏标题与简要说明 */}
                <div className="pb-3 mb-3 border-b border-gray-100 dark:border-[#1e222f] shrink-0">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span>模型提供方与模型映射</span>
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    左侧选择模型提供方，右侧查看与管理该提供方的模型映射列表。
                  </p>
                </div>

                {/* 左右结构统一容器：中间仅用一条竖线隔开 (满足需求1) */}
                <div className="flex-1 flex min-h-0 overflow-hidden border border-gray-200 dark:border-[#1e222f] rounded-2xl bg-white dark:bg-[#12141c]">
                  {/* 左侧提供方栏 (约 35% 宽度，单竖线分隔) */}
                  <div className="w-[35%] min-w-[220px] max-w-[320px] shrink-0 flex flex-col bg-gray-50/50 dark:bg-[#0e1017] border-r border-gray-200 dark:border-[#1e222f] overflow-hidden">
                    {/* 左侧顶栏：与右侧顶栏高度、背景、边框、对齐完全一致 (满足需求2) */}
                    <div className="h-11 px-3.5 bg-gray-100/70 dark:bg-[#151722] border-b border-gray-200 dark:border-[#1e222f] flex items-center justify-between shrink-0">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">提供方列表</span>
                      <button
                        type="button"
                        onClick={handleOpenAdd}
                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs"
                        title="添加自定义提供方"
                      >
                        <Plus size={12} />
                        <span>添加提供方</span>
                      </button>
                    </div>

                    {/* 提供方卡片列表 */}
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
                      {providers.length === 0 ? (
                        <div className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">
                          暂无模型提供方
                        </div>
                      ) : (
                        providers.map((p) => {
                          const isSelected = selectedProvider && ((selectedProvider.id && selectedProvider.id === p.id) || selectedProvider.name === p.name);
                          const isConnected = p.status === "connected";
                          return (
                            <div
                              key={p.id || p.name}
                              onClick={() => setSelectedProviderId(p.id || p.name)}
                              className={`p-2.5 rounded-xl border cursor-pointer transition flex flex-col gap-1.5 relative group ${
                                isSelected
                                  ? "bg-white dark:bg-[#1d202e] border-blue-500 dark:border-blue-500 shadow-xs ring-1 ring-blue-500/20"
                                  : "bg-white/80 dark:bg-[#151824] border-gray-200/70 dark:border-[#222636] hover:border-gray-300 dark:hover:border-[#2f354a]"
                              }`}
                            >
                              {/* 提供方名称与状态指示 */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? "bg-green-500" : "bg-red-400"}`} />
                                  <span className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
                                  {p.is_custom && (
                                    <span className="text-[9px] px-1 py-0.2 bg-gray-100 dark:bg-[#282d3f] text-gray-500 rounded font-normal shrink-0">自定义</span>
                                  )}
                                </div>

                                {/* 悬停/选中操作图标 (编辑提供方 / 删除提供方) */}
                                <div className={`flex items-center gap-0.5 transition shrink-0 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleOpenEdit(p); }}
                                    className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-[#282d3f] rounded transition cursor-pointer"
                                    title="修改提供方配置"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteProvider(p.id || p.name); }}
                                    className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition cursor-pointer"
                                    title="删除提供方"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>

                              {/* 底部协议与模型个数 */}
                              <div className="flex items-center justify-between text-[10px] text-gray-400">
                                <span className="font-mono truncate max-w-[110px]" title={p.protocol}>
                                  {p.protocol === "openai_responses" ? "/v1/responses" : p.protocol === "anthropic_messages" ? "/v1/messages" : p.protocol === "gemini_v1beta" ? "/v1beta" : "/chat/completions"}
                                </span>
                                <span className="bg-gray-100 dark:bg-[#222534] px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-400 shrink-0">
                                  {p.models ? p.models.length : 0} 个模型
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>


                  </div>

                  {/* 右侧：模型映射管理栏 (约 65% 宽度，flex-1 弹性充满，显著大于左侧) */}
                  <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-[#13151f] overflow-hidden">
                    {/* 右侧顶栏：与左侧顶栏高度、背景、样式完全对齐一致，删除图一冗余元素 (满足需求2) */}
                    <div className="h-11 px-4 bg-gray-100/70 dark:bg-[#151722] border-b border-gray-200 dark:border-[#1e222f] flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                          模型映射列表
                        </span>
                        {selectedProvider && (
                          <span className="text-[11px] text-gray-400 font-normal truncate">
                            ({selectedProvider.name})
                          </span>
                        )}
                      </div>

                      {selectedProvider && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingModel(true);
                            setNewModelName("");
                            if (inlineFetchedModels.length === 0 && selectedProvider?.base_url && selectedProvider?.api_key) {
                              handleFetchInlineRemoteModels();
                            }
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs shrink-0"
                          title="添加模型映射"
                        >
                          <Plus size={12} />
                          <span>添加模型</span>
                        </button>
                      )}
                    </div>

                    {selectedProvider ? (
                      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                        {/* 内联添加模型卡片 (增加刷新与下拉框，满足需求3) */}
                        {isAddingModel && (
                          <div className="p-3 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-xl space-y-2.5 animate-in fade-in">
                            <div className="flex items-center justify-between text-xs font-semibold text-blue-900 dark:text-blue-300">
                              <div className="flex items-center gap-2">
                                <span>添加模型映射到「{selectedProvider.name}」</span>
                                {inlineFetchSuccess && (
                                  <span className="text-[11px] text-green-600 dark:text-green-400 font-normal">
                                    ({inlineFetchSuccess})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {/* 刷新按钮：获取该请求地址和 API 能够使用的模型 */}
                                <button
                                  type="button"
                                  onClick={handleFetchInlineRemoteModels}
                                  disabled={isFetchingInlineModels}
                                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 bg-white dark:bg-[#1a1d2b] rounded-md border border-blue-200 dark:border-blue-800/40 transition cursor-pointer disabled:opacity-50"
                                  title="从该提供方拉取可用模型列表"
                                >
                                  <RotateCw size={11} className={isFetchingInlineModels ? "animate-spin text-blue-600" : ""} />
                                  <span>{isFetchingInlineModels ? "正在获取..." : "刷新模型"}</span>
                                </button>
                                <button onClick={() => setIsAddingModel(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer">
                                  <X size={14} />
                                </button>
                              </div>
                            </div>

                            {inlineFetchError && (
                              <div className="flex items-center gap-1.5 p-1.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded text-red-600 dark:text-red-400 text-xs">
                                <AlertCircle size={12} className="shrink-0" />
                                <span>{inlineFetchError}</span>
                              </div>
                            )}

                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                autoFocus
                                value={newModelName}
                                onChange={(e) => setNewModelName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleConfirmAddModel();
                                  if (e.key === "Escape") setIsAddingModel(false);
                                }}
                                placeholder="输入模型标识，或从右侧下拉选择"
                                className="flex-1 min-w-0 px-3 py-1.5 bg-white dark:bg-[#1c1f2c] border border-gray-200 dark:border-[#2c3246] rounded-lg text-xs font-mono outline-none focus:border-blue-500"
                              />

                              {/* 图三布局：右侧紧凑的 [ v ] 下拉选择按钮，不占一半宽度 (满足需求1) */}
                              <div className="relative w-8 h-8 shrink-0">
                                <div className="w-8 h-8 flex items-center justify-center bg-white hover:bg-gray-100 dark:bg-[#1c1f2c] dark:hover:bg-[#252838] border border-gray-200 dark:border-[#2c3246] text-gray-600 dark:text-gray-300 rounded-lg transition pointer-events-none">
                                  {isFetchingInlineModels ? (
                                    <Loader2 size={13} className="animate-spin text-blue-500" />
                                  ) : (
                                    <ChevronDown size={14} />
                                  )}
                                </div>
                                {inlineFetchedModels.length > 0 ? (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        setNewModelName(e.target.value);
                                      }
                                    }}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer font-mono text-xs"
                                    title="选择已获取到的模型"
                                  >
                                    <option value="" disabled hidden>选择模型...</option>
                                    {inlineFetchedModels.map((fm) => (
                                      <option key={fm} value={fm}>
                                        {fm}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={handleFetchInlineRemoteModels}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    title="点击刷新获取远端可用模型"
                                  />
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={handleConfirmAddModel}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition cursor-pointer shrink-0"
                              >
                                确认添加
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsAddingModel(false)}
                                className="px-2.5 py-1.5 border border-gray-200 dark:border-[#2c3246] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#202332] text-xs rounded-lg transition cursor-pointer shrink-0"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 模型映射卡片列表 */}
                        {(!selectedProvider.models || selectedProvider.models.length === 0) ? (
                          <div className="py-12 flex flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500 space-y-3">
                            <Cpu size={32} className="opacity-30" />
                            <p className="text-xs">该提供方暂未配置任何模型映射</p>
                            <button
                              type="button"
                              onClick={() => {
                                setIsAddingModel(true);
                                setNewModelName("");
                                if (inlineFetchedModels.length === 0 && selectedProvider?.base_url && selectedProvider?.api_key) {
                                  handleFetchInlineRemoteModels();
                                }
                              }}
                              className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40 rounded-xl text-xs font-medium hover:bg-blue-100 transition cursor-pointer"
                            >
                              + 点击添加第一个模型映射
                            </button>
                          </div>
                        ) : (
                          selectedProvider.models.map((m) => {
                            const isEditing = editingModelName === m;
                            const isCurrent = currentModel === m;
                            const testStatus = modelTestResults[m];
                            const isTesting = testingModelName === m;

                            return (
                              <div key={m} className="space-y-1.5">
                                {isEditing ? (
                                  /* 编辑状态：输入框 + 图三布局紧凑 [ v ] 下拉选择框 + 保存/取消 (满足需求2) */
                                  <div className="space-y-1.5">
                                    <div className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-blue-50/40 dark:bg-blue-950/20 border border-blue-400 dark:border-blue-600/60 rounded-xl transition shadow-xs">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <Cpu size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                                      <input
                                        type="text"
                                        autoFocus
                                        value={editingModelInput}
                                        onChange={(e) => setEditingModelInput(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleSaveEditModel();
                                          if (e.key === "Escape") setEditingModelName(null);
                                        }}
                                        placeholder="输入模型标识，或点击右侧下拉选择"
                                        className="flex-1 min-w-0 px-2.5 py-1 bg-white dark:bg-[#1a1d2b] border border-blue-400 dark:border-blue-500 rounded-lg text-xs font-mono text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
                                      />

                                      {/* 图三布局：编辑时增加 [ v ] 下拉选择框按钮 (满足需求2) */}
                                      <div className="relative w-7 h-7 shrink-0">
                                        <div className="w-7 h-7 flex items-center justify-center bg-white hover:bg-gray-100 dark:bg-[#1a1d2b] dark:hover:bg-[#252838] border border-blue-400 dark:border-blue-500 text-gray-600 dark:text-gray-300 rounded-lg transition pointer-events-none">
                                          {isFetchingInlineModels ? (
                                            <Loader2 size={12} className="animate-spin text-blue-500" />
                                          ) : (
                                            <ChevronDown size={13} />
                                          )}
                                        </div>
                                        {inlineFetchedModels.length > 0 ? (
                                          <select
                                            value=""
                                            onChange={(e) => {
                                              if (e.target.value) {
                                                setEditingModelInput(e.target.value);
                                              }
                                            }}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer font-mono text-xs"
                                            title="从已获取的模型中选择替换"
                                          >
                                            <option value="" disabled hidden>选择模型...</option>
                                            {inlineFetchedModels.map((fm) => (
                                              <option key={fm} value={fm}>
                                                {fm}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={handleFetchInlineRemoteModels}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            title="点击拉取远端可用模型"
                                          />
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={handleSaveEditModel}
                                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs"
                                      >
                                        保存
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingModelName(null)}
                                        className="px-2.5 py-1 border border-gray-200 dark:border-[#2f354a] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#202332] rounded-lg text-xs transition cursor-pointer"
                                      >
                                        取消
                                      </button>
                                    </div>
                                  </div>
                                    {inlineFetchError && editingModelName === m && (
                                      <div className="flex items-center gap-1.5 p-1.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded text-red-600 dark:text-red-400 text-xs">
                                        <AlertCircle size={12} className="shrink-0" />
                                        <span>{inlineFetchError}</span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  /* 常规状态：左侧模型与状态，右侧三个纯图标按钮 (无文字，固定尺寸 w-7 h-7，满足需求3) */
                                  <div className="w-full flex items-center justify-between px-3.5 py-2.5 bg-white dark:bg-[#181a24] border border-gray-200/80 dark:border-[#222636] rounded-xl hover:border-gray-300 dark:hover:border-[#2f354a] transition group shadow-2xs">
                                    {/* 左侧：模型名称与状态徽章 */}
                                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                                      <Cpu size={14} className="text-blue-500 shrink-0" />
                                      <span className="font-mono font-medium text-xs text-gray-900 dark:text-gray-100 truncate" title={m}>
                                        {m}
                                      </span>

                                      {isCurrent && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40 shrink-0 whitespace-nowrap">
                                          当前激活
                                        </span>
                                      )}

                                      {isTesting && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center gap-1 shrink-0 whitespace-nowrap">
                                          <Loader2 size={10} className="animate-spin text-blue-500" />
                                          <span>测试中</span>
                                        </span>
                                      )}

                                      {!isTesting && testStatus && (
                                        <span
                                          className={`text-[10px] px-1.5 py-0.2 rounded-full flex items-center gap-1 shrink-0 whitespace-nowrap ${
                                            testStatus.success
                                              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/30"
                                              : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/30"
                                          }`}
                                          title={testStatus.message}
                                        >
                                          {testStatus.success ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                                          <span>{testStatus.success ? "连通成功" : "测试失败"}</span>
                                        </span>
                                      )}
                                    </div>

                                    {/* 右侧：三个纯图标按钮 “编辑、测试连接、删除” (无文字，固定尺寸 w-7 h-7) */}
                                    <div className="flex items-center gap-1 shrink-0">
                                      {/* 1. 编辑 (纯图标) */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingModelName(m);
                                          setEditingModelInput(m);
                                          if (inlineFetchedModels.length === 0 && selectedProvider?.base_url && selectedProvider?.api_key) {
                                            handleFetchInlineRemoteModels();
                                          }
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-[#252838] rounded-lg transition cursor-pointer"
                                        title="编辑模型名称"
                                      >
                                        <Edit2 size={13} />
                                      </button>

                                      {/* 2. 测试连接 (纯图标) */}
                                      <button
                                        type="button"
                                        disabled={isTesting}
                                        onClick={() => handleTestSingleModel(selectedProvider, m)}
                                        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-gray-100 dark:hover:bg-[#252838] rounded-lg transition cursor-pointer disabled:opacity-50"
                                        title="测试连接"
                                      >
                                        {isTesting ? (
                                          <Loader2 size={13} className="animate-spin text-blue-500" />
                                        ) : (
                                          <Zap size={13} />
                                        )}
                                      </button>

                                      {/* 3. 删除 (纯图标) */}
                                      <button
                                        type="button"
                                        onClick={() => handlePromptDeleteModel(selectedProvider, m)}
                                        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition cursor-pointer"
                                        title="删除模型"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* 单个模型测试失败，下方展示详细错误原因 */}
                                {testStatus && !testStatus.success && (
                                  <div className="flex items-start gap-1.5 p-2 bg-red-50/80 dark:bg-red-950/20 border border-red-200/80 dark:border-red-900/40 rounded-lg text-red-600 dark:text-red-400 text-[11px] leading-relaxed break-all">
                                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                                    <span>{testStatus.message}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-400 dark:text-gray-500 space-y-2">
                        <Cpu size={36} className="opacity-25" />
                        <p className="text-xs">请在左侧选择一个模型提供方查看其模型映射，或在下方添加新提供方</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
{activeTab === "security" && (
              <div className="space-y-4 text-xs max-w-4xl">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">安全与执行模式</h2>
                </div>

                {/* 1. Auto 模式 */}
                <div className="p-4 bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl space-y-2">
                  <div className="font-semibold text-blue-900 dark:text-blue-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap size={16} className="text-blue-600 dark:text-blue-400" />
                      <span>Auto 模式 (日常开发推荐)</span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">Default</span>
                  </div>
                  <p className="text-blue-800 dark:text-blue-300/80 leading-relaxed text-[11px]">
                    <strong>核心特点：</strong>日常开发最推荐，效率与安全兼顾。<br />
                    • <strong>编辑文件：</strong>安全修改，无需逐次打扰；<br />
                    • <strong>跑 Shell 命令：</strong>安全命令全自动放行，底层绝对阻断高危破坏性命令（如 rm -rf、format）与凭据窥探。
                  </p>
                </div>

                {/* 2. Edit automatically 模式 */}
                <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl space-y-2">
                  <div className="font-semibold text-emerald-900 dark:text-emerald-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileEdit size={16} className="text-emerald-600 dark:text-emerald-400" />
                      <span>Edit automatically (自动编辑模式)</span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">Fast Edit</span>
                  </div>
                  <p className="text-emerald-800 dark:text-emerald-300/80 leading-relaxed text-[11px]">
                    <strong>核心特点：</strong>适合目标明确、快速修改代码与重构。<br />
                    • <strong>编辑文件：</strong>直接改，不问；<br />
                    • <strong>跑 Shell 命令：</strong>只读/测试命令（git status、pytest、npm test 等）自动放行，任何修改系统环境的未知命令均须审批。
                  </p>
                </div>

                {/* 3. Plan 模式 */}
                <div className="p-4 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl space-y-2">
                  <div className="font-semibold text-amber-900 dark:text-amber-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Compass size={16} className="text-amber-600 dark:text-amber-400" />
                      <span>Plan 模式 (方案先行规划)</span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">Read-Only Planning</span>
                  </div>
                  <p className="text-amber-800 dark:text-amber-300/80 leading-relaxed text-[11px]">
                    <strong>核心特点：</strong>适合大重构、复杂疑难任务，先审批方案。<br />
                    • <strong>编辑文件：</strong>不动手，先出方案！写文件与打补丁将被底层拦截；<br />
                    • <strong>跑 Shell 命令：</strong>仅允许只读探索命令（代码走查、状态检测），严禁运行具有变更副作用的指令。
                  </p>
                </div>

                {/* 4. Manual 模式 */}
                <div className="p-4 bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 rounded-xl space-y-2">
                  <div className="font-semibold text-purple-900 dark:text-purple-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-purple-600 dark:text-purple-400" />
                      <span>Manual 模式 (步步为营手动审批)</span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">Strict</span>
                  </div>
                  <p className="text-purple-800 dark:text-purple-300/80 leading-relaxed text-[11px]">
                    <strong>核心特点：</strong>步步为营，最安全但最累。<br />
                    • <strong>编辑文件：</strong>每次修改或新建文件均须弹窗确认；<br />
                    • <strong>跑 Shell 命令：</strong>每一条终端命令下发前均须开发者手动审批允许。
                  </p>
                </div>
              </div>
            )}

            {activeTab === "general" && (
              <div className="space-y-6 text-xs max-w-4xl">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">通用设置</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    自定义界面外观、字号缩放比例、系统运行参数与注意力预算策略。
                  </p>
                </div>

                {/* 1. 外观主题选择区 (对标需求 4：和谐高品质深色外观) */}
                <div className="space-y-3 pt-1 border-t border-gray-100 dark:border-[#1e222f]">
                  <label className="block text-gray-800 dark:text-gray-200 font-semibold text-xs">界面外观风格</label>
                  <p className="text-[11px] text-gray-400">选择您喜爱的应用主题风格，已适配所有窗口与面板色彩系统。</p>
                  
                  <div className="grid grid-cols-2 gap-4 pt-1">
                    {/* 浅色主题卡片 */}
                    <div
                      onClick={() => onSelectTheme && onSelectTheme("light")}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                        theme === "light"
                          ? "border-blue-600 bg-blue-50/40 dark:bg-blue-950/20 shadow-xs"
                          : "border-gray-200 dark:border-[#262a38] hover:border-gray-300 dark:hover:border-[#383e54] bg-white dark:bg-[#171922]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3.5 h-3.5 rounded-full border border-gray-300 bg-white" />
                          <span className="font-semibold text-gray-900 dark:text-white text-xs">浅色</span>
                        </div>
                        {theme === "light" && <Check size={14} className="text-blue-600" />}
                      </div>
                      <div className="w-full h-12 rounded-lg bg-[#ffffff] border border-gray-200 p-1.5 flex gap-1.5 items-center">
                        <div className="w-4 h-full bg-[#f8f9fa] rounded border border-gray-100" />
                        <div className="flex-1 space-y-1">
                          <div className="w-3/4 h-2 bg-gray-100 rounded" />
                          <div className="w-1/2 h-2 bg-blue-100 rounded" />
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2">浅色 (明快清晰 / 白底)</p>
                    </div>

                    {/* 深色主题卡片 */}
                    <div
                      onClick={() => onSelectTheme && onSelectTheme("dark")}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                        theme === "dark"
                          ? "border-blue-600 bg-blue-50/20 dark:bg-blue-950/30 shadow-xs"
                          : "border-gray-200 dark:border-[#262a38] hover:border-gray-300 dark:hover:border-[#383e54] bg-white dark:bg-[#171922]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3.5 h-3.5 rounded-full border border-gray-600 bg-[#0f1117]" />
                          <span className="font-semibold text-gray-900 dark:text-white text-xs">深色</span>
                        </div>
                        {theme === "dark" && <Check size={14} className="text-blue-600" />}
                      </div>
                      <div className="w-full h-12 rounded-lg bg-[#0f1117] border border-[#2b3042] p-1.5 flex gap-1.5 items-center">
                        <div className="w-4 h-full bg-[#171922] rounded border border-[#2b3042]" />
                        <div className="flex-1 space-y-1">
                          <div className="w-3/4 h-2 bg-gray-700 rounded" />
                          <div className="w-1/2 h-2 bg-blue-500/40 rounded" />
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2">深色 (沉浸护眼深黑)</p>
                    </div>
                  </div>
                </div>

                {/* 2. 字体大小左右滑动设置 (对标需求 5：初始值默认已加大一号，可左右滑动无级缩放) */}
                <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-[#1e222f]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200 text-xs">
                        <Type size={14} className="text-blue-600 dark:text-blue-400" />
                        <span>界面字体大小</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        滑动调整全桌面界面的字体大小，当前默认字号已整体放大一档以优化阅读体验。
                      </p>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shrink-0">
                      {fontSizeLevel === 0 && "小 (标准)"}
                      {fontSizeLevel === 1 && "默认 (推荐 · 已加大)"}
                      {fontSizeLevel === 2 && "中 (舒适阅读)"}
                      {fontSizeLevel === 3 && "大 (大字清晰)"}
                      {fontSizeLevel === 4 && "特大 (超大)"}
                    </span>
                  </div>

                  {/* 滑动滑块条 */}
                  <div className="p-3 bg-gray-50 dark:bg-[#181a24] border border-gray-200 dark:border-[#262a38] rounded-xl space-y-2">
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={1}
                      value={fontSizeLevel}
                      onChange={(e) => onSelectFontSize && onSelectFontSize(Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 dark:bg-[#2b3042] rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <div className="flex justify-between text-[11px] text-gray-400 dark:text-gray-500 font-medium px-0.5 select-none">
                      <span className={fontSizeLevel === 0 ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>小</span>
                      <span className={fontSizeLevel === 1 ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>默认</span>
                      <span className={fontSizeLevel === 2 ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>中</span>
                      <span className={fontSizeLevel === 3 ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>大</span>
                      <span className={fontSizeLevel === 4 ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>特大</span>
                    </div>
                  </div>
                </div>


              </div>
            )}

            {activeTab === "about" && (
              <div className="space-y-4 text-xs max-w-4xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img src={LOGO_DATA_URI} alt="super logo" className="w-10 h-10 object-contain" />
                    <div>
                      <h2 className="text-base font-bold text-gray-900 dark:text-white">super HARNESS 桌面客户端</h2>
                      <p className="text-xs text-gray-500 dark:text-gray-400">版本 v5.7.16 · DeepSeek Harness 架构增强版</p>
                    </div>
                  </div>

                  {/* 检测版本按钮 (对标图五需求 3) */}
                  <button
                    type="button"
                    onClick={handleCheckVersion}
                    disabled={checkVersionStatus === "checking"}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#181a24] hover:bg-gray-50 dark:hover:bg-[#20222f] border border-gray-200 dark:border-[#2b3042] text-gray-700 dark:text-gray-200 rounded-xl text-xs font-medium transition cursor-pointer shadow-2xs shrink-0"
                  >
                    {checkVersionStatus === "checking" ? (
                      <Loader2 size={13} className="animate-spin text-blue-500" />
                    ) : (
                      <RefreshCw size={13} className="text-gray-500 dark:text-gray-400" />
                    )}
                    <span>{checkVersionStatus === "checking" ? "正在检测版本..." : "检测版本"}</span>
                  </button>
                </div>

                {/* 检测结果状态提示卡片 */}
                {checkVersionStatus === "latest" && (
                  <div className="flex items-center gap-2 p-3 bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={16} className="shrink-0" />
                    <span className="font-medium">当前已是最新版本 (v5.7.16)，与 GitHub 官方发布版本一致。</span>
                  </div>
                )}

                {checkVersionStatus === "has_update" && (
                  <div className="p-4 bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300 font-semibold">
                        <Sparkles size={16} />
                        <span>发现新版本: {latestVersion} (当前为 v5.7.16)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenRelease()}
                        className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-xs transition cursor-pointer"
                      >
                        <Download size={13} />
                        <span>下载更新安装最新版</span>
                      </button>
                    </div>
                    {updateNote && (
                      <p className="text-[11px] text-blue-900/80 dark:text-blue-300/80 line-clamp-2">
                        更新日志: {updateNote}
                      </p>
                    )}
                  </div>
                )}

                {checkVersionStatus === "error" && (
                  <div className="flex items-center justify-between p-3 bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-amber-800 dark:text-amber-300">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>检测版本超时或网络未连接，可前往 GitHub Releases 页面查看。</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenRelease("https://github.com/dotcom888/super-harness/releases")}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                    >
                      访问 Releases
                    </button>
                  </div>
                )}

                <div className="p-4 bg-gray-50 dark:bg-[#181a24] border border-gray-200 dark:border-[#262a38] rounded-xl space-y-2 text-gray-600 dark:text-gray-300">
                  <p>super HARNESS 是专为智能体工程化研发打造的深度强化工作站。</p>
                  <p>支持多项目工作区并行隔离、自动化工具执行与长程注意力上下文管理。</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 1. 提供方删除桌面端确认弹窗 */}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteProviderId)}
        title="删除模型提供方"
        message="确定要删除该提供方配置吗？删除后此模型将从对话切换栏中移除。"
        confirmText="确定删除"
        danger={true}
        onConfirm={handleConfirmDeleteProvider}
        onCancel={() => setPendingDeleteProviderId(null)}
      />

      {/* 2. 模型映射删除桌面端确认弹窗 */}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteModel)}
        title="删除模型映射"
        message={`确定要从提供方「${pendingDeleteModel?.provider.name}」中移除模型映射「${pendingDeleteModel?.model}」吗？移除后该模型将从对话切换栏中移除。`}
        confirmText="确定移除"
        danger={true}
        onConfirm={handleConfirmDeleteModel}
        onCancel={() => setPendingDeleteModel(null)}
      />

      {/* 3. 提供方新增与基础配置编辑弹窗 (统一 300ms 平滑缩放淡入淡出) */}
      <ModalTransition
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
        zIndex={120}
        duration={300}
      >
        <div className="w-[520px] max-w-[94vw] bg-white dark:bg-[#181a24] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#2a2e3f] overflow-hidden p-5 space-y-3.5 text-xs text-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
            <span className="font-bold text-gray-900 dark:text-white text-sm">
              {editingProvider ? `编辑提供方配置: ${editingProvider.name}` : "新增自定义模型提供方"}
            </span>
            <button
              onClick={() => setIsProviderModalOpen(false)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div>
            <label className="block text-gray-600 dark:text-gray-400 font-medium mb-1">提供方名称</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="例如: DeepSeek"
              className="w-full px-3 py-1.5 bg-white dark:bg-[#1f2230] border border-gray-200 dark:border-[#2e344a] text-gray-900 dark:text-gray-100 rounded-lg focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-gray-600 dark:text-gray-400 font-medium mb-1">接口地址 (Base URL)</label>
            <input
              type="text"
              value={formBaseUrl}
              onChange={(e) => setFormBaseUrl(e.target.value)}
              placeholder="例如: https://api.deepseek.com/v1"
              className="w-full px-3 py-1.5 bg-white dark:bg-[#1f2230] border border-gray-200 dark:border-[#2e344a] text-gray-900 dark:text-gray-100 rounded-lg focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-gray-600 dark:text-gray-400 font-medium mb-1 flex items-center justify-between">
              <span>接口协议 / 报文格式 (Protocol)</span>
              <span className="text-[11px] text-blue-600 dark:text-blue-400 font-normal">默认: /chat/completions</span>
            </label>
            <select
              value={formProtocol}
              onChange={(e) => setFormProtocol(e.target.value)}
              className="w-full px-3 py-1.5 bg-white dark:bg-[#1f2230] border border-gray-200 dark:border-[#2e344a] text-gray-900 dark:text-gray-100 rounded-lg focus:border-blue-500 outline-none cursor-pointer"
            >
              <option value="openai_chat">OpenAI 兼容 (/chat/completions) (推荐)</option>
              <option value="openai_responses">OpenAI Responses (/v1/responses)</option>
              <option value="anthropic_messages">Anthropic Claude (/v1/messages)</option>
              <option value="gemini_v1beta">Google Gemini (/v1beta)</option>
            </select>
          </div>

          <div>
            <label className="block text-gray-600 dark:text-gray-400 font-medium mb-1">API 密钥 (API Key)</label>
            <div className="relative flex items-center">
              <input
                type={showApiKey ? "text" : "password"}
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-1.5 pr-9 bg-white dark:bg-[#1f2230] border border-gray-200 dark:border-[#2e344a] text-gray-900 dark:text-gray-100 rounded-lg focus:border-blue-500 outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer p-0.5"
                title={showApiKey ? "隐藏密钥" : "显示密钥"}
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-gray-600 dark:text-gray-400 font-medium">模型映射列表 (一行一个)</label>
                {modalFetchSuccess && (
                  <span className="text-[11px] text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-800/30">
                    {modalFetchSuccess}
                  </span>
                )}
              </div>
              {/* 刷新按钮：获取该请求地址和 API 能够使用的模型 (满足需求2) */}
              <button
                type="button"
                onClick={handleFetchModalRemoteModels}
                disabled={isFetchingModalModels}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 bg-blue-50/70 hover:bg-blue-100/70 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 rounded-lg border border-blue-200 dark:border-blue-800/40 transition cursor-pointer disabled:opacity-50"
                title="从远端接口拉取可用的模型标识列表"
              >
                <RotateCw size={12} className={isFetchingModalModels ? "animate-spin text-blue-600" : ""} />
                <span>{isFetchingModalModels ? "正在获取..." : "刷新可用模型"}</span>
              </button>
            </div>

            {modalFetchError && (
              <div className="flex items-center gap-1.5 p-2 mb-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-lg text-red-600 dark:text-red-400 text-xs">
                <AlertCircle size={13} className="shrink-0" />
                <span>{modalFetchError}</span>
              </div>
            )}

            {/* 一行一个模型映射，每一行右侧新增下拉框按钮 */}
            <div className="space-y-2 max-h-[175px] overflow-y-auto pr-1">
              {formModelList.map((modelVal, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={modelVal}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormModelList((prev) => prev.map((m, i) => (i === idx ? val : m)));
                    }}
                    placeholder="例如: deepseek-chat 或右侧下拉选择"
                    className="flex-1 px-3 py-1.5 bg-white dark:bg-[#1f2230] border border-gray-200 dark:border-[#2e344a] text-gray-900 dark:text-gray-100 rounded-lg focus:border-blue-500 outline-none font-mono text-xs"
                  />

                  {/* 图三布局：右侧紧凑的 [ v ] 下拉选择按钮，不占一半宽度 (满足需求1) */}
                  <div className="relative w-8 h-8 shrink-0">
                    <div className="w-8 h-8 flex items-center justify-center bg-gray-50 hover:bg-gray-100 dark:bg-[#202332] dark:hover:bg-[#282d3f] border border-gray-200 dark:border-[#2e344a] text-gray-600 dark:text-gray-300 rounded-lg transition pointer-events-none">
                      {isFetchingModalModels ? (
                        <Loader2 size={13} className="animate-spin text-blue-500" />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </div>
                    {modalFetchedModels.length > 0 ? (
                      <select
                        value=""
                        onChange={(e) => {
                          const selected = e.target.value;
                          if (selected) {
                            setFormModelList((prev) => prev.map((m, i) => (i === idx ? selected : m)));
                          }
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer font-mono text-xs"
                        title="选择已获取到的模型"
                      >
                        <option value="" disabled hidden>选择模型...</option>
                        {modalFetchedModels.map((fm) => (
                          <option key={fm} value={fm}>
                            {fm}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={handleFetchModalRemoteModels}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        title="点击刷新获取远端可用模型"
                      />
                    )}
                  </div>

                  {/* 删除当前行 */}
                  {formModelList.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setFormModelList((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition cursor-pointer shrink-0"
                      title="移除此行"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* 添加一行按钮 */}
            <button
              type="button"
              onClick={() => setFormModelList((prev) => [...prev, ""])}
              className="mt-2 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium cursor-pointer"
            >
              <Plus size={13} />
              <span>+ 添加一行模型</span>
            </button>
          </div>

          {/* 校验错误与连通性提示 */}
          {validationError && (
            <div className="flex items-center gap-1.5 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-lg text-red-600 dark:text-red-400 text-xs">
              <AlertCircle size={14} className="shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {testResult && (
            <div className={`flex items-start gap-1.5 p-2 rounded-lg text-xs border ${
              testResult.success 
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/40 text-green-700 dark:text-green-400"
                : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-400"
            }`}>
              {testResult.success ? (
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{testResult.message}</span>
            </div>
          )}

          {saveSuccessMsg && (
            <div className="flex items-center gap-1.5 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 rounded-lg text-green-700 dark:text-green-400 text-xs animate-in fade-in">
              <CheckCircle2 size={14} className="shrink-0" />
              <span className="font-medium">{saveSuccessMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-900/20 hover:bg-blue-100/70 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg font-medium transition cursor-pointer disabled:opacity-50"
            >
              {isTesting && <Loader2 size={13} className="animate-spin text-blue-600" />}
              <span>{isTesting ? "正在测试..." : "测试提供方连通性"}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsProviderModalOpen(false)}
                className="px-3.5 py-1.5 border border-gray-200 dark:border-[#2e344a] text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-[#222534] transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveProviderForm}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-xs cursor-pointer"
              >
                保存并生效
              </button>
            </div>
          </div>
        </div>
      </ModalTransition>
    </div>
  );
};
