call npm uninstall pddl-workspace

:: rmdir node_modules\pddl-workspace
:: rmdir node_modules\ai-planning-val

:: rmdir /S node_modules

call npm install pddl-workspace@latest --save

call npm install