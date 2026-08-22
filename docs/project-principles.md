# Project principles

## Why MabelTV exists

MabelTV began as one particular television made by Dan for his daughter, Mabel. It is intended to give her a calm, deliberate way to watch programmes chosen by her family, without the noise, recommendations, accounts, advertising, and unlimited choice of a normal smart television.

KidsTV is the reusable software underneath that television. It may also make another family television, such as JohnTV, practical to set up. That does not change the centre of the project: MabelTV is a personal family project, not a streaming platform or a business waiting to be launched.

## The child's experience comes first

The child-facing experience should remain simple, dependable, and intentional. More features are not automatically an improvement. A change earns its place when it makes the television more enjoyable, more appropriate, or easier for the child to understand at their current age.

The limitations are part of the design. A bounded library, simple controls, and the absence of endless browsing are not deficiencies to be engineered away.

## Polish gives the grown-up confidence

Installation, recovery, updates, rollback, remote setup, and the parent dashboard are primarily for the grown-up maintaining the television. Their purpose is to remove uncertainty and make experimentation safe.

If the Pi, storage, or installation is lost, there should be a clear route back to a working television without reconstructing old terminal commands or relying on memory. A dependable recovery path gives Dan the freedom to keep improving Mabel's experience without fearing that one unsuccessful experiment will destroy the known-good version.

Polish is worthwhile even when a screen or recovery tool is rarely seen. It makes MabelTV pleasant to own and maintain, rather than merely possible to operate.

## Local and self-contained by design

MabelTV uses a family-supplied local media library and remains useful without an internet connection, external account, subscription, or cloud service. This supports predictable playback, privacy, travel, and recovery, while keeping the family in control of what appears on the television.

Network libraries and commercial streaming integrations are not current goals. They should not be introduced merely because they are technically possible or because a hypothetical wider market might expect them.

## Product quality does not require a commercial product

KidsTV should be cleanly packaged, reproducible, documented, testable, and straightforward to install. Building it as though another person might need to operate or recover it is a useful engineering standard.

That standard does not create an obligation to sell it. Supporting one or two family installations is different from designing for unknown customers, distributing media, integrating subscription services, or operating a support business. Commercial concerns should not distort the personal purpose of the project unless Dan consciously changes that purpose later.

## Preserve the known-good television

The current child interface is a baseline, not something that must be discarded whenever a new idea appears. Significant visual or behavioural experiments should be introduced in a way that preserves a clear path back to the working version.

New interfaces can exist alongside the original. This allows different television surrounds, alternative parent controls, and other experiments without turning every idea into an irreversible redesign.

## Let it grow with Mabel

MabelTV does not need to remain frozen at the age for which its first interface was designed. It can develop as Mabel grows, with different levels of choice, information, and control becoming appropriate over time.

This should be a gradual response to the child Mabel becomes, not an attempt to predict every requirement years in advance. Family viewing can continue on the normal television, while MabelTV remains the deliberate way she watches independently.

Some additions may create family rituals rather than simply adding functions. A future movie-night mode, for example, could use a cinema presentation, title card, introduction, interval, and closing sequence to make watching a chosen film feel special. Ideas like this fit when they deepen the experience rather than imitate a streaming service.

## Automation should be intelligent and reversible

Tools made for Dan should replace fragile, hard-to-remember procedures with clear and repeatable workflows. They should inspect what they are given, make decisions appropriate to the source, explain meaningful outcomes, preserve originals, validate their results, and fail safely.

Detailed technical policies belong in the relevant implementation and operations documentation. Project principles should describe the desired outcome rather than freeze one command or conversion rule forever.

## A test for future work

Before expanding MabelTV, ask:

1. Does this improve Mabel's experience, or materially improve Dan's ability to create, maintain, or recover it?
2. Is it responding to a real need rather than an imagined commercial audience?
3. Does it preserve the calm, bounded, local-first character of the television?
4. Can it be introduced without losing the known-good version or the route back to it?
5. Is the added complexity proportionate to the benefit?

If the answers are unclear, leaving MabelTV as it is remains a valid decision.
