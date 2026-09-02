import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowUpRightIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  LaptopIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { dockRelease } from '#/lib/dock-release'

export const Route = createFileRoute('/connect')({ component: ConnectRoute })

function ConnectRoute() {
  const { t } = useTranslation('appShell')
  const [agent, setAgent] = useState<'codex' | 'hermes'>('codex')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const endpoint = 'https://loginom.duckdns.org/mcp'
  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpoint)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
      <div className="max-w-2xl space-y-3">
        <p className="text-sm font-medium text-primary">Loginom Dock</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t('connect.title')}
        </h1>
        <p className="text-muted-foreground">{t('connect.description')}</p>
      </div>
      <div
        className="grid gap-3 sm:grid-cols-2"
        aria-label={t('connect.choose')}
      >
        {(['codex', 'hermes'] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={agent === name}
            onClick={() => setAgent(name)}
            className={`flex items-center gap-4 rounded-xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${agent === name ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'}`}
          >
            {name === 'codex' ? (
              <LaptopIcon className="size-6" />
            ) : (
              <BotIcon className="size-6" />
            )}
            <span className="flex-1">
              <span className="block text-lg font-semibold">
                {name === 'codex' ? 'Codex' : 'Hermes'}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(`connect.${name}Description`)}
              </span>
            </span>
            {agent === name && <CheckIcon className="size-5 text-primary" />}
          </button>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('connect.stepsTitle')}</CardTitle>
            <CardDescription>{t('connect.requirements')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ol className="space-y-5">
              {[1, 2, 3].map((step) => (
                <li key={step} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {step}
                  </span>
                  <span className="pt-0.5 text-sm leading-relaxed">
                    {t(`connect.${agent}Step${step}`)}
                  </span>
                </li>
              ))}
            </ol>
            {dockRelease.url && dockRelease.version ? (
              <Button
                render={
                  <a href={dockRelease.url} target="_blank" rel="noreferrer" />
                }
              >
                {t('connect.download', { version: dockRelease.version })}
                <ArrowUpRightIcon />
              </Button>
            ) : (
              <div
                role="status"
                className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
              >
                {t('connect.pending')}
              </div>
            )}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('connect.addressTitle')}</CardTitle>
              <CardDescription>
                {t('connect.addressDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                {endpoint}
              </p>
              <Button variant="outline" onClick={copyEndpoint}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {t(copied ? 'connect.copied' : 'connect.copy')}
              </Button>
              {copyFailed && (
                <p role="alert" className="text-sm text-muted-foreground">
                  {t('connect.copyFailed')}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('connect.sharedTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>{t('connect.sharedDescription')}</p>
              <p>{t('connect.localDescription')}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
