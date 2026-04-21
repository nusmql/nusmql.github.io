---
author: Lei
pubDatetime: 2026-04-21T00:00:00Z
title: Building a Multi-Step Wizard Engine for Terminal UIs in Go
slug: building-a-wizard-engine-for-terminal-uis-in-go
featured: true
draft: false
tags:
  - go
  - tui
  - cli
  - bubble-tea
description: How we built a declarative wizard engine on top of Bubble Tea to orchestrate a 13-step VM deployment flow in the Verda CLI — with dependency tracking, back-navigation, and actor-model views.
---

*I'm the author of [verda-cli](https://github.com/verda-cloud/verda-cli) and [verdagostack](https://github.com/verda-cloud/verdagostack) at [Verda Cloud](https://verda.com), where we build GPU cloud infrastructure. This post is about a problem we solved in the open source CLI tooling.*

## Table of contents

## The Problem

When building the [Verda CLI](https://github.com/verda-cloud/verda-cli) — a command-line tool for managing GPU cloud infrastructure — we ran into a common challenge: deploying a VM requires collecting 10+ pieces of information from the user. Location, instance type, OS image, SSH keys, storage volumes, startup scripts, billing type, contract period... the list goes on.

A flat sequence of prompts doesn't cut it. Users need to:

- **Go back** and change earlier answers
- **See progress** through the flow
- **Skip steps** that don't apply (e.g., no contract selection for spot instances)
- **Get dynamic choices** that depend on prior answers (available images depend on the chosen instance type)
- **Run sub-flows** inline (create a new SSH key mid-wizard without leaving the flow)
- **See a cost summary** that updates as they make selections

We needed a **wizard engine** — something that orchestrates multi-step interactive flows with dependency tracking, back-navigation, and extensible UI components. And it had to work in the terminal.

## The TUI Landscape: Why Go, Not React?

If you're building a multi-step terminal wizard from scratch, the **React ecosystem is arguably the best choice**. [Ink](https://github.com/vadimdemedes/ink) brings React's declarative component model to the terminal — you get JSX, hooks, state management, and the entire npm ecosystem for free. The composability story is unmatched: build a wizard step as a component, compose steps into flows, reuse across projects. Libraries like [Pastel](https://github.com/vadimdemedes/pastel) add routing on top. It's how tools like Cloudflare's Wrangler build their CLI experiences.

**So why didn't we use it?**

Our team writes Go. The Verda CLI is Go. The API SDK is Go. The shared library (`verdagostack`) is Go. Introducing a Node.js runtime for the TUI layer would mean:

- A separate build pipeline and dependency tree
- Runtime dependency on Node.js for end users
- Context-switching between Go (business logic) and TypeScript (UI)
- No reuse of our existing Go packages (options, logging, error types)

We needed the wizard engine to live *inside* the same binary — not as a separate process.

Within the Go ecosystem, **[Bubble Tea](https://github.com/charmbracelet/bubbletea)** is the clear foundation. It's mature, actively maintained, and built on The Elm Architecture. The companion libraries — Lip Gloss for styling, Bubbles for components — give you solid primitives. But Bubble Tea is a *framework*, not a wizard toolkit. You get text inputs, lists, and spinners — not multi-step flows with dependency tracking and back-navigation.

Other Go options fell short: **Survey** is archived. **Huh** handles forms, not dynamic wizard flows with async loaders. Nothing gave us the declarative step-based engine we needed.

So we built one on top of Bubble Tea.

## A Quick Primer: The Elm Architecture

Bubble Tea is built on [The Elm Architecture](https://guide.elm-lang.org/architecture/) (TEA) — a pattern that emerged from the Elm programming language for building interactive programs. It later influenced frameworks like Redux in the JavaScript world. The core idea is simple — three parts:

- **Model** — your application state
- **View** — a function that renders state to the screen
- **Update** — a function that takes a message and produces new state

They form a loop: the View renders the Model, the user interacts with it, interactions become messages, Update processes messages into a new Model, and View renders again.

In Bubble Tea, this looks like:

```go
type Model struct {
    cursor  int
    choices []string
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyPressMsg:
        if msg.String() == "up"   { m.cursor-- }
        if msg.String() == "down" { m.cursor++ }
    }
    return m, nil
}

func (m Model) View() string {
    // render choices with cursor indicator
}
```

This is elegant for a single screen — a select list, a text input, a spinner. The model owns the state, Update handles input, View renders output. Clean, predictable, testable. The pattern "emerges naturally," as the Elm guide puts it — you don't have to force it.

But a wizard isn't a single screen. It's a *sequence* of screens where each one depends on prior answers, fetches data from APIs, and shares state with views like progress bars and cost summaries. TEA gives you one Update loop for one model. A 13-step wizard with dynamic dependencies needs something on top — an orchestrator that manages *which* model is active, *what* state carries forward, and *how* views outside the current prompt stay in sync.

That's the gap the wizard engine fills.

## What Makes Terminal Wizards Hard

Using Bubble Tea for a single prompt is straightforward. Using it for a 13-step wizard with API calls, conditional branching, and sub-flows? That's where the problems start.

### 1. The stdin Problem

Bubble Tea manages terminal raw mode through a `tea.Program`. One program, one stdin reader. But in a wizard, a step's loader might need to show its own interactive prompt — like letting the user create a new SSH key mid-flow. That means a second `tea.Program` trying to read from the same stdin. Two programs fighting over input. Terminal state corruption. Lost keystrokes.

### 2. State Reversal

Users expect to press Esc and go back. But "go back" in a wizard isn't just re-showing the previous prompt. You need to:
- Reset the value bound to the previous step
- Invalidate any cached data that depended on that value
- Skip over steps that were auto-skipped or fixed via flags
- Re-run loaders if dependencies changed

Every step transition must be fully reversible — or you end up with stale state leaking into later steps.

### 3. Dynamic Dependencies

Available OS images depend on the chosen instance type. Instance types depend on billing type and kind (GPU vs CPU). Contract options only appear for non-spot billing. These aren't static forms — the shape of the flow changes based on user input. You need a dependency graph, not a flat list.

### 4. Async Loading with Feedback

Each step might need to fetch data from an API. Users shouldn't stare at a frozen terminal. You need spinners, but spinners are themselves Bubble Tea programs — which brings us back to the stdin problem.

### 5. Extensible UI Beyond Prompts

A progress bar that tracks completion. A hint bar showing contextual keybindings. A cost summary that updates as selections change. These aren't prompts — they're *views* that react to wizard state. Bubble Tea doesn't have a built-in pattern for this.

## What We Built

We built a wizard engine as part of [verdagostack](https://github.com/verda-cloud/verdagostack), our shared Go library. The design has four layers:

```
┌─────────────────────────────────────────────┐
│  Application (verda-cli)                    │
│  Define Flow + Steps + custom Views         │
├─────────────────────────────────────────────┤
│  Wizard Engine                              │
│  Orchestrates steps, manages state,         │
│  handles navigation                         │
├─────────────────────────────────────────────┤
│  MessageBus + Views (actor model)           │
│  ProgressView, HintBarView, custom views    │
├─────────────────────────────────────────────┤
│  Prompter + Status (abstract interfaces)    │
│  Bubbletea backend (or test mock)           │
└─────────────────────────────────────────────┘
```

### Declarative Steps

A wizard flow is a list of steps. Each step declares *what* it needs — the engine handles *how*.

```go
type Step struct {
    Name        string
    Prompt      PromptType                    // Select, TextInput, Confirm, ...
    Required    bool
    Loader      LoaderFunc                    // fetch choices (async, with spinner)
    DependsOn   []string                      // invalidate when these steps change
    ShouldSkip  func(collected map[string]any) bool
    Default     func(collected map[string]any) any
    Validate    func(value any) error
    Setter      func(value any)               // write to caller's struct
    Resetter    func()                        // clear on back/skip
    IsSet       func() bool                   // pre-filled via flag?
    Value       func() any                    // current pre-filled value
}
```

This is the key abstraction. The application defines a step by saying: "this step is a select prompt, it depends on `billing-type`, here's how to load choices, here's how to validate, and here's where to write the result." The engine does the rest.

A real example — the contract step in VM creation:

```go
wizard.Step{
    Name:      "contract",
    Prompt:    wizard.SelectPrompt,
    Required:  true,
    DependsOn: []string{"billing-type"},
    ShouldSkip: func(c map[string]any) bool {
        return c["billing-type"] == "spot"  // no contract for spot instances
    },
    Loader: func(ctx context.Context, _ tui.Prompter, status tui.Status, store *wizard.Store) ([]wizard.Choice, error) {
        choices := []wizard.Choice{
            {Label: "Pay as you go", Value: "payg"},
        }
        periods, err := withSpinner(ctx, status, "Loading contract options...", func() ([]Period, error) {
            return client.LongTerm.GetInstancePeriods(ctx)
        })
        // ... build choices from API response
        return choices, nil
    },
    Setter:   func(v any) { opts.Contract = v.(string) },
    Resetter: func() { opts.Contract = "" },
}
```

Notice: the Loader receives a `status` parameter for showing spinners, and a `store` for reading prior answers. `DependsOn` tells the engine to re-run this loader if `billing-type` changes. `ShouldSkip` removes the step entirely for spot instances.

### The Engine: How Navigation Works

The engine walks through steps one by one, but it's not a simple loop. Each step is evaluated before showing it to the user:

- **Skip it** — the step doesn't apply (spot billing → no contract step)
- **Pre-fill it** — the value was already provided via CLI flag, no prompt needed
- **Load and prompt** — fetch choices from the API, show the prompt

The interesting part is **going back**. When a user presses Esc, the engine doesn't just show the previous prompt again. It *resets* everything that depended on that answer. Change your billing type from reserved to spot? The contract step disappears, instance type choices reload with spot pricing, and the cost summary updates — automatically.

This works because each step declares its dependencies:

```go
DependsOn: []string{"billing-type"}
```

When a dependency changes, the engine invalidates cached choices downstream and re-runs loaders on the next visit. The application doesn't manage this — the engine does.

One edge case we had to solve: what if a required step has no available choices? The user can't skip it and can't pick from an empty list. The engine **auto-rewinds** to the nearest dependency so the user can change an earlier answer that might unlock options. A guard prevents infinite loops.

The result: users can freely navigate back and forth through a 13-step flow, and the wizard always stays consistent.

### Views: Reacting to Wizard State

A wizard isn't just a sequence of prompts. You want a progress bar, contextual keyboard hints, maybe a cost summary that updates live. These are *views* — UI elements that react to what's happening in the wizard but aren't prompts themselves.

We modeled views as independent actors. Each view has one job:

```go
type View interface {
    Update(msg any) (render string, publish []any)
    Subscribe() []reflect.Type
}
```

A view receives messages, returns what to render, and optionally publishes messages for other views. That's it. Views don't know about each other. They don't know about the engine internals. They just react to events.

The **MessageBus** routes events between the engine and views. When the engine advances to a new step, it broadcasts a `StepChangedMsg`. When a user completes a step, it broadcasts `CollectedChangedMsg`. Views subscribe to what they care about:

- **ProgressView** listens to step changes → updates "Step 4 of 13" with a progress bar
- **HintBarView** listens to step changes → shows relevant keybindings ("↑/↓ navigate, type to filter, esc back")
- **SummaryView** (custom, in verda-cli) listens to collected values → recalculates cost breakdown as the user selects instance types and storage

The bus only re-renders views whose output actually changed — no flicker, no redundant terminal writes.

This pattern made it easy to extend. When we needed a deployment cost summary for `verda vm create`, we wrote a single `summaryView` struct that subscribes to value changes, looks up pricing, and renders a table. The engine and other views didn't need to change at all.

### Solving the stdin Problem

Remember the core challenge: Bubble Tea's `tea.Program` owns stdin. One program, one reader. But our wizard needs loaders that show spinners (which are `tea.Program`s) and steps that run interactive sub-flows (like creating an SSH key mid-wizard — that's another prompt, another program).

We solved this with two execution modes:

**Per-prompt mode** (default, real terminal): The engine runs a fresh `tea.Program` for each prompt. Before running a step's loader, it stops the current program — freeing stdin for the loader to create spinners or sub-prompts. When the loader finishes, a new program starts for the next prompt. Clean handoff, no races.

**Persistent mode** (piped input, testing): A single `tea.Program` runs for the entire wizard using a **composite model** — one model that wraps all prompts and swaps the active one as steps advance. This mode exists because restarting programs with piped input loses buffered bytes.

```go
if e.reader != nil {
    return e.runPersistentProgram(ctx)  // pipe: one program, composite model
}
return e.runPerPromptProgram(ctx)       // terminal: fresh program per step
```

The composite model receives a `showPromptMsg` to swap prompts, routes wizard-level keybindings (Ctrl+C, Esc) before forwarding to the active prompt, and merges hint bars from both the wizard and the current prompt.

This was the hardest problem to get right. We went through three iterations — the git history tells the story. But the result is that loaders can freely show spinners, run sub-prompts, even launch nested select flows, all without stdin conflicts.

## The Outcome

Here's what a wizard flow looks like in practice. The Verda CLI's `verda vm create` command is a 13-step wizard:

```
$ verda vm create

 ████████████░░░░░░░░  Step 4 of 13

? Instance type
  > 1× V100 16GB — €1.23/hr
    1× A100 40GB — €2.45/hr
    8× H100 80GB — €25.60/hr

  ↑/↓ navigate  type to filter  enter select  esc back
```

The user selects billing type, contract, GPU kind, instance type, location, OS image, storage volumes, SSH keys, and startup script — with a live progress bar, contextual hints, and a cost summary that appears before final confirmation.

Defining this flow in code is declarative:

```go
flow := &wizard.Flow{
    Name: "vm-create",
    Layout: []wizard.ViewDef{
        {ID: "progress", View: wizard.NewProgressView(wizard.WithProgressPercent())},
        {ID: "hints",    View: wizard.NewHintBarView(wizard.WithHintStyle(bubbletea.HintStyle()))},
    },
    Steps: []wizard.Step{
        stepBillingType(opts),
        stepContract(getClient, opts),
        stepKind(opts),
        stepInstanceType(getClient, cache, opts),
        stepLocation(getClient, cache, opts),
        stepImage(getClient, opts),
        stepOSVolumeSize(opts),
        stepStorage(getClient, cache, opts),
        stepSSHKeys(getClient, opts),
        stepStartupScript(getClient, opts),
        stepHostname(opts),
        stepDescription(opts),
        stepConfirmDeploy(opts),
    },
}

engine := wizard.NewEngine(prompter, status, wizard.WithExitConfirmation())
engine.Run(ctx, flow)
```

Each step is self-contained: it knows how to load its choices, when to skip itself, what it depends on, and where to write its result. Add a step, remove a step, reorder — the engine handles navigation and dependencies.

The same engine powers `verda auth login` (4 steps), `verda template create` (variant of the VM flow), and any future wizard we need. It ships as part of `verdagostack`, so any Go CLI can use it.

## What We'd Do Differently

**Start with the composite model.** We built per-prompt mode first, hit stdin races, then designed the composite model. If we'd understood the problem upfront, we'd have started there.

**Formal step graph, not a list.** Steps are an ordered slice with `DependsOn` strings. A proper DAG would make dependency resolution more explicit and enable parallel loading of independent steps.

**Built-in sub-flow primitive.** Our storage step runs its own select loop inside a loader — it works, but it's a pattern that should be a first-class concept in the engine.

## Takeaways

- **Bubble Tea is the right foundation** — but multi-step wizards need an orchestration layer on top.
- **Declare steps, don't impeach them.** Step definitions with loaders, dependencies, and skip conditions let the engine handle the hard parts.
- **Actor-model views** keep UI concerns decoupled. Adding a cost summary didn't touch a single line of engine code.
- **stdin ownership is the hardest problem** in terminal UI. Plan for it early.

The wizard engine is open source as part of [verdagostack](https://github.com/verda-cloud/verdagostack/tree/main/pkg/tui/wizard). If you're building multi-step CLI flows in Go, give it a look.
