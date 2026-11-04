# Observed execution preview

The existing isolated contract runner can record the actual result of each declared call while it checks the saved source. It does not run the contracts again or make network requests. The recorded output includes return values, decoded events and native balance changes in the declared fixture state. The scenario report binds these observations to the source, compiler artifacts and independent check plan.

The owner can expand Simulation in the saved project. The view labels the fixture environment, raw units and exclusion of gas fees. It also shows failed or reverted calls. A return value that differs from the independent expectation is still recorded as observed; expected values are never substituted for execution results.

The recorder retains the first 24 executed steps within a 60 KB payload budget. Individual output values and decoded event arguments are bounded. Missing or clipped details are explicit. Constructors and unexecuted steps are not presented as observed user actions. This is an inspection of saved declared scenarios, not an arbitrary new scenario runner or proof of live operation.

Numeric and scenario questions can include a compact projection of these observations in the planner's existing call. Ordinary image, copy and unrelated edits omit the trace. Private project ownership and the existing provider limits are unchanged. The browser cache is advisory and cannot authorize a launch.
