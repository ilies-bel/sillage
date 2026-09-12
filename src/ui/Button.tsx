/**
 * Buttons — and the reason a disabled one is disabled.
 *
 * DEC-26 says a control that cannot work is never offered as a dead button.
 * Where a control genuinely has to stay on screen and stay unavailable, the
 * reason goes *beside* it, in French, in the DOM. Not in a `title` attribute
 * (which no touch, no keyboard and no screen-reader user reaches), not in a
 * tooltip, not only in a comment.
 *
 * That is enforced by the type, not by review: `disabled: true` is only
 * constructible together with `disabledReason`, and a blank reason throws. The
 * cost is real and deliberate — `disabled={busy}` no longer compiles, and the
 * author has to decide what "Envoi en cours…" should say. That decision is the
 * feature.
 *
 * On colour: `--accent` is not a button fill here. VISION.md §6 gives orange
 * exactly one meaning — armed or recording — and explicitly excludes primary
 * buttons. It is also 2.44:1 against white, so the white-on-orange *Valider* and
 * *Démarrer* that the screens carry today are unreadable to anyone who needs
 * contrast. `primary` is `--brand-700` (6.28:1 with white on it), which is the
 * step of the ramp VISION.md §6 nominates for exactly this.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

/*
 * `disabled:opacity-50` was the whole of the disabled treatment, and on
 * `primary` it produced a *lighter navy pill with white text on it* — a control
 * that still reads as the thing to press, and whose label lands around 2.6:1.
 * A rep pressed it, nothing happened, and the reason was 12px grey underneath.
 *
 * So each variant states what it looks like when it cannot be used. `primary`
 * gives up its fill entirely: a disabled primary is not a quieter primary, it
 * is not a primary. `bordered` keeps its shape and loses its ink, which is what
 * a form control that is present-but-inert should look like.
 */
/*
 * **Every control is at least 24px tall, whatever its ink.**
 *
 * WCAG 2.2's *Target Size (Minimum)*, and it is not a phone concern: the reps
 * this ships to are on Windows laptops with trackpads (HR-2). A 19px `nav` or
 * `text` control sits in a dense rail beside eleven others, and a miss costs a
 * click that lands on the row below — which on the review gate is a field
 * nobody meant to touch. Measured rather than eyeballed: `py-1.5` looks
 * generous in the source and resolves to nineteen pixels once the line-height
 * under `--type-ui` lands, which is what `shot.mjs --targets` found on eight
 * controls of the gate alone.
 *
 * `inline-flex` + `items-center` rather than more padding, because padding
 * moves the *text*: these controls sit on shared baselines with labels beside
 * them — « ‹ Calendrier » next to a title, « Copier » next to a section header
 * — and growing the box downward would have shifted every one of those. The
 * glyph stays where it was and the hit area grows around it.
 *
 * `justify-center` so `block` buttons still centre their label.
 *
 * **A press moves the control one pixel, and three variants deliberately do not.**
 *
 * Measured across six stages, the whole of this product's motion vocabulary was
 * **one** animated property: 307 colour transitions and four `riseIn`s. Nothing
 * anywhere answered a *press* — a rep's finger went down on a button and the
 * screen said nothing until whatever the press did had finished, which on a
 * cloud transcription key or a VerySwing push is not instant. The published
 * standard writes this as `scale(0.97)` on `:active`; VISION.md §6 gives this
 * product « opacity and 2–4px translate only », so it is a one-pixel translate
 * instead, on the existing `transition` (now the fast rung, 90ms).
 *
 * `enabled:` and not bare `active:`, because a disabled control that sinks under
 * the finger is the DEC-26 dead button pretending to work.
 *
 * `primary`, `caution` and `danger` are **excluded**, and that is US-3's own
 * out-of-scope line rather than an oversight: those three are what the review
 * gate's decision ships on, and this file already carries the reason one screen
 * over — the page turn and *Valider* were the same DOM node in the same
 * rectangle 63ms apart, and the shared `transition` painted the ship's fill
 * under the turn's label for one frame. `POST /v1/crm/tasks` has no idempotency
 * key. The one control that writes into a client's CRM does not move under the
 * finger, and adding motion to it is a decision for DEC-4, not for a motion
 * round.
 */
const button = cva(
  'inline-flex min-h-[24px] shrink-0 items-center justify-center transition disabled:cursor-not-allowed',
  {
  variants: {
    variant: {
      /** The default control: a bordered chip of a button on a card. */
      bordered:
        'border-card bg-inner text-strong hover:bg-subtle disabled:bg-subtle disabled:text-muted disabled:hover:bg-subtle enabled:active:translate-y-px rounded-sm border px-3 py-1.5 text-ui font-medium',
      /** One per view at most. Brand blue marks action and navigation. */
      primary:
        'bg-brand-700 text-inner disabled:bg-subtle disabled:text-muted rounded-sm px-3 py-1.5 text-ui font-medium',
      /**
       * The primary, when what it ships carries a doubt the app measured.
       *
       * The confirmation gate used to draw a pixel-identical mid-blue *Valider*
       * whether every citation had been verified or whether a field had failed —
       * on the one screen whose entire claim over a general-purpose notetaker is
       * that it checks its own sentences against the recording (DEC-21). A `⚠`
       * in a header six rows above a button that looks like every other button
       * is decoration.
       *
       * Same shape, same weight, same position — it is still the one control and
       * it still ships (DEC-4). Only the colour and the label change, and they
       * change because the payload did.
       */
      caution: 'bg-warn text-inner disabled:bg-subtle disabled:text-muted rounded-sm px-3 py-1.5 text-ui font-medium',
      /**
       * The way back out of a screen — *‹ Calendrier*, and only that.
       *
       * VISION.md §6: « Brand blue marks selection and navigation ». The back
       * links were `text`, which is `--text-muted`, the same grey as every
       * caption and every unavailable reason on the page. The one control that
       * moves a rep between screens should not be the quietest thing on it.
       * `--brand-700` is 6.28:1 on white and the step the ramp nominates for
       * links.
       */
      nav: 'text-brand-700 hover:text-brand-900 disabled:text-muted enabled:active:translate-y-px text-ui',
      /**
       * An irreversible stop, confirmed.
       *
       * One caller: the widget's second press, the one that ends a recording
       * (`src/widget/Widget.tsx`). It is not a general « destructive » tone and
       * must not become one — `--danger` carries « something is wrong » on every
       * other surface in this product, and a palette that also spends it on
       * ordinary controls teaches a rep to read it as decoration.
       *
       * `--danger` is 5.47:1 on white, so `text-inner` on it clears AA both
       * ways round. The filled shape is the point: the confirmation has to be a
       * different rectangle from the label the rep just pressed, and a bordered
       * copy of it would not be.
       */
      danger: 'bg-danger text-inner rounded-sm px-3 py-1.5 text-ui font-medium',
      /** Header links, *Réessayer*, pane toggles. Density over decoration. */
      text: 'text-muted hover:text-body disabled:opacity-60 enabled:active:translate-y-px text-ui',
      /** The same, when it needs to read as a link rather than a control. */
      link: 'text-muted hover:text-body disabled:opacity-60 enabled:active:translate-y-px text-ui underline',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'bordered', block: false },
  },
)

/**
 * Available, or unavailable *with a stated reason*. There is no third case, and
 * no way to spell "disabled, reason to follow".
 */
type Availability =
  | { disabled?: false; disabledReason?: never }
  | { disabled: true; disabledReason: string }

/**
 * The union above cannot be produced by a conditional spread — `{...(busy ? {…}
 * : {})}` widens `disabled` to `true | undefined`, which matches neither member
 * and is a type error at the call site. That is the type working, but it pushes
 * every transient-busy button into a two-branch ternary around the whole
 * element, and a rule that is annoying to obey is a rule that gets a
 * `@ts-expect-error` instead.
 *
 * So: one helper, returning the union already narrowed. The reason is still
 * mandatory — there is no arity of this function that yields a disabled button
 * without one — and a blank one still throws in `Button`.
 */
export const unavailable = (when: boolean, reason: string): Availability =>
  when ? { disabled: true, disabledReason: reason } : {}

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'className' | 'type'
> &
  VariantProps<typeof button> &
  Availability & {
    children: ReactNode
    className?: string
    /** Always explicit. A bare `<button>` inside a form submits it. */
    type?: 'button' | 'submit'
  }

export function Button({
  variant,
  block,
  className,
  children,
  disabled,
  disabledReason,
  type = 'button',
  ...rest
}: ButtonProps) {
  const reasonId = useId()

  if (disabled && disabledReason.trim() === '') {
    throw new Error(
      'Button: a disabled control must carry a French reason next to it (DEC-26). ' +
        '`disabledReason` cannot be blank.',
    )
  }

  const control = (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-describedby={disabled ? reasonId : undefined}
      className={cn(button({ variant, block }), className)}
    >
      {children}
    </button>
  )

  if (!disabled) return control

  /*
   * `inline-flex` so dropping this into the flex header rows the screens
   * already use does not reflow them — the wrapper occupies the space the bare
   * button did, with the reason stacked under it.
   */
  return (
    <span className={cn('inline-flex min-w-0 flex-col items-start gap-tight', block && 'w-full')}>
      {control}
      <span id={reasonId} className="text-muted text-meta">
        {disabledReason}
      </span>
    </span>
  )
}
