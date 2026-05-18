import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText,
  Settings,
  FilePlus,
  Folder as FolderIcon,
  ChevronDown,
  PanelRightOpen,
  PanelRightClose,
  Sparkles,
  TextSelect,
  ScrollText,
  Languages,
  FileSearch,
  BookOpen,
  HelpCircle,
  Wand2,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editor';
import { useWorkspaceStore } from '@/stores/workspace';
import { useSettingsStore } from '@/stores/settings';
import { useEditorCommandsStore } from '@/stores/editor-commands';
import { useAIBlogJobStore } from '@/stores/ai-blog-job';
import { useT } from '@/i18n';
import { docBasename } from '@/lib/doc-io';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface TitleBarProps {
  onNewDoc?: () => void;
  onOpenDoc?: () => void;
}

export function TitleBar({ onNewDoc, onOpenDoc }: TitleBarProps): JSX.Element {
  const t = useT();
  const path = useEditorStore((s) => s.path);
  const dirty = useEditorStore((s) => s.dirty);
  const active = useWorkspaceStore((s) => s.active);
  const known = useWorkspaceStore((s) => s.known);
  const sidebarVisible = useSettingsStore((s) => s.sidebarVisible);
  const aiEnabled = useSettingsStore((s) => s.aiEnabled);
  const updateSettings = useSettingsStore((s) => s.update);
  const requestAiCmd = useEditorCommandsStore((s) => s.request);

  const activeWorkspaceName =
    known.find((w) => w.path === active)?.name ?? (active ? docBasename(active) : '—');

  const onRevealDoc = (): void => {
    if (path) window.api.workspace.revealInFinder(path).catch(() => null);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex h-10 select-none items-center justify-between border-b border-border bg-background/80 pl-20 pr-2"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex items-center gap-2 overflow-hidden"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <WorkspaceSwitcher
            align="start"
            trigger={
              <button
                className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
                title={active ?? undefined}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-[10rem] truncate">{activeWorkspaceName}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
              </button>
            }
          />

          {path && (
            <button
              className="flex max-w-[36rem] items-center gap-1 truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={onRevealDoc}
              title={t('titlebar.tooltip.revealInFinder')}
            >
              <span className="opacity-50">/</span>
              <span className="truncate">{docBasename(path)}</span>
              <span className="shrink-0">{dirty ? '·' : '✓'}</span>
            </button>
          )}
        </div>

        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {aiEnabled && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('titlebar.tooltip.ai')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>{t('titlebar.ai.label')}</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => useAIBlogJobStore.getState().openDialog()}>
                  <Wand2 className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{t('titlebar.ai.generateFromReader')}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {t('titlebar.ai.generateFromReader.hint')}
                    </span>
                  </div>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {t('titlebar.ai.polish')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-56">
                      <DropdownMenuItem
                        onClick={() => requestAiCmd({ kind: 'polish', target: 'selection' })}
                      >
                        <TextSelect className="mr-2 h-4 w-4" /> {t('titlebar.ai.target.selection')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => requestAiCmd({ kind: 'polish', target: 'document' })}
                      >
                        <ScrollText className="mr-2 h-4 w-4" /> {t('titlebar.ai.target.document')}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Languages className="mr-2 h-4 w-4" />
                    {t('titlebar.ai.translate')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-64">
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('titlebar.ai.translate.selectionLabel')}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() =>
                          requestAiCmd({ kind: 'translate', target: 'selection', lang: 'en' })
                        }
                      >
                        {t('titlebar.ai.translate.toEnglish')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          requestAiCmd({ kind: 'translate', target: 'selection', lang: 'zh' })
                        }
                      >
                        {t('titlebar.ai.translate.toChinese')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('titlebar.ai.translate.documentLabel')}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() =>
                          requestAiCmd({ kind: 'translate', target: 'document', lang: 'en' })
                        }
                      >
                        {t('titlebar.ai.translate.toEnglish')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          requestAiCmd({ kind: 'translate', target: 'document', lang: 'zh' })
                        }
                      >
                        {t('titlebar.ai.translate.toChinese')}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuItem onClick={() => requestAiCmd({ kind: 'summarize' })}>
                  <FileSearch className="mr-2 h-4 w-4" />
                  {t('titlebar.ai.summarize')}
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => requestAiCmd({ kind: 'explain' })}>
                  <BookOpen className="mr-2 h-4 w-4" />
                  {t('titlebar.ai.explain')}
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => requestAiCmd({ kind: 'interpret' })}>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{t('titlebar.ai.interpret')}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {t('titlebar.ai.interpret.hint')}
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {onNewDoc && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onNewDoc}>
                  <FilePlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('titlebar.tooltip.newDoc')}</TooltipContent>
            </Tooltip>
          )}

          {onOpenDoc && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onOpenDoc}>
                  <FileText className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('titlebar.tooltip.openDoc')}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  window.api.app.openSettings().catch((e) => console.error('[settings]', e))
                }
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('titlebar.tooltip.settings')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => updateSettings({ sidebarVisible: !sidebarVisible })}
              >
                {sidebarVisible ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {sidebarVisible
                ? t('titlebar.tooltip.hideSidebar')
                : t('titlebar.tooltip.showSidebar')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
