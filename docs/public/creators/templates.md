---
description: Publish reusable behavior through the Module Mode contribution workflow
---

# Reusable modules

Modules are the reusable building blocks offered through Module Mode. A module supplies a versioned implementation and declares its configuration, required capabilities and management actions. Creators select compatible modules when they launch a coin.

## Publish a module

Use the [module contribution API](../developers/module-mode.md) to submit the exact source package, configuration contract, author wallet, reward wallet and required evidence. Review checks the implementation and its compatibility with the host. Catalog publication makes that specific revision available to creators.

Every launched coin records the revisions and configuration it selected. A new source revision, dependency, permission or fee rule needs its own version and review. Changes to an existing coin follow its deployed contracts and management permissions.

## Earn from use

Rewards follow the host and fee split recorded at launch. Foundation modules can receive a configured share of the creator fee. Earlier Native and Engine versions use their own author-fee policy. Read [Fees and revenue](../economics.md#module-mode) and the selected release instead of assuming one allocation applies to every host.

Publishing a module makes it available for use. Earnings start when a coin using it generates fees allocated to that module. Claims follow the deployed module's recipient and withdrawal rules.

## Custom projects

A Custom Launch submits one concrete token and contract package. It does not create a Module Mode catalog entry. Reusable source in a Custom project can be published in its repository, but catalog distribution uses the separate module contribution workflow.

Historical template application records remain available in Launch Policy. They are records of the former intake process, not the current submission route.
