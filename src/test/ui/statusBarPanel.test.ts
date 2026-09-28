import * as assert from 'assert';
import * as vscode from 'vscode';
import { disabledInlineSuggestOverrides, enabledConfigAfterMenuToggle, StatusBarPanel } from '../../ui/statusBarPanel';
import { modelSettingScope } from '../../config/modelSettingScope';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

suite('StatusBarPanel', () => {
    test('clear cache invalidates live providers and stored suggestions', () => {
        const calls: string[] = [];
        const panel = new StatusBarPanel(
            { enabled: true } as never,
            { enabled: true, nextCursorPredictionEnabled: false } as never,
            { info() { calls.push('log'); } } as never,
            { clear() { calls.push('ghost cache'); } } as never,
            { clearAll() { calls.push('nes cache'); } } as never,
        );
        try {
            panel.setCacheInvalidators(
                () => calls.push('ghost requests'),
                () => calls.push('nes requests'),
            );
            (panel as unknown as { _clearCaches(): void })._clearCaches();
            assert.deepStrictEqual(calls, [
                'ghost requests', 'nes requests', 'ghost cache', 'nes cache', 'log',
            ]);
        } finally {
            (panel as unknown as { _statusBarItem: vscode.StatusBarItem })._statusBarItem.dispose();
        }
    });

    test('menu toggles the native wildcard unless the language has its own setting', () => {
        assert.deepStrictEqual(enabledConfigAfterMenuToggle({ '*': true, python: false }, 'yaml', false),
            { '*': false, python: false });
        assert.deepStrictEqual(enabledConfigAfterMenuToggle({ '*': false, python: false }, 'yaml', true),
            { '*': true, python: false });
        assert.deepStrictEqual(enabledConfigAfterMenuToggle({ '*': true, yaml: true }, 'yaml', false),
            { '*': true, yaml: false });
        assert.deepStrictEqual(enabledConfigAfterMenuToggle(true, 'yaml', false), { '*': false });
    });

    test('changes a configured model at its existing scope', async () => {
        assert.strictEqual(modelSettingScope({ workspaceValue: 'workspace-model' }), vscode.ConfigurationTarget.Workspace);
        assert.strictEqual(modelSettingScope({}), vscode.ConfigurationTarget.Global);
        const config = vscode.workspace.getConfiguration('cc-completion.ghost');
        const inspected = config.inspect<string>('model');
        const ghostTarget = modelSettingScope(inspected);
        const previous = ghostTarget === vscode.ConfigurationTarget.Workspace
            ? inspected?.workspaceValue : inspected?.globalValue;
        const nesConfig = vscode.workspace.getConfiguration('cc-completion.nes');
        const nesInspected = nesConfig.inspect<string>('model');
        const nesTarget = modelSettingScope(nesInspected);
        const previousNes = nesTarget === vscode.ConfigurationTarget.Workspace
            ? nesInspected?.workspaceValue : nesInspected?.globalValue;
        let ghostClears = 0;
        let nesClears = 0;
        const panel = new StatusBarPanel(
            { enabled: true, model: 'before' } as never,
            { enabled: true, model: 'before', nextCursorPredictionEnabled: false } as never,
            { info() {}, debug() {}, error() {} } as never,
            { clear() { ghostClears++; } } as never,
            { clearAll() { nesClears++; } } as never,
        );
        const statusBar = (panel as unknown as { _statusBarItem: vscode.StatusBarItem })._statusBarItem;
        try {
            await (panel as unknown as { _updateModel(kind: 'ghost' | 'nes', model: string): Promise<void> })
                ._updateModel('ghost', 'test-completion-model');
            assert.strictEqual(vscode.workspace.getConfiguration('cc-completion.ghost').get<string>('model'),
                'test-completion-model');
            assert.strictEqual(ghostClears, 1);
            assert.strictEqual(nesClears, 0);
            await (panel as unknown as { _updateModel(kind: 'ghost' | 'nes', model: string): Promise<void> })
                ._updateModel('nes', 'test-edit-model');
            assert.strictEqual(vscode.workspace.getConfiguration('cc-completion.nes').get<string>('model'),
                'test-edit-model');
            assert.strictEqual(ghostClears, 1);
            assert.strictEqual(nesClears, 1);
        } finally {
            statusBar.dispose();
            await config.update('model', previous, ghostTarget);
            await nesConfig.update('model', previousNes, nesTarget);
        }
    });

    test('preserves the workspace model override when changing models', () => {
        assert.strictEqual(modelSettingScope({
            workspaceValue: 'workspace-default', globalValue: 'global-default',
        }), vscode.ConfigurationTarget.Workspace);
    });

    test('enables the most specific disabled language override first', () => {
        const overrides = disabledInlineSuggestOverrides({
            workspaceFolderLanguageValue: false,
            workspaceValue: false,
            globalLanguageValue: false,
        });
        assert.deepStrictEqual(overrides.map(override => [override.target, override.languageOverride]), [
            [vscode.ConfigurationTarget.WorkspaceFolder, true],
            [vscode.ConfigurationTarget.Workspace, false],
            [vscode.ConfigurationTarget.Global, true],
        ]);
    });

    test('does not write settings that are already enabled', () => {
        assert.deepStrictEqual(disabledInlineSuggestOverrides({
            workspaceFolderLanguageValue: true,
            workspaceValue: true,
            globalValue: true,
        }), []);
        assert.deepStrictEqual(disabledInlineSuggestOverrides(undefined), []);
    });

    test('enables a language-level VS Code inline setting', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'yaml', content: 'services:\n  web:' });
        await vscode.window.showTextDocument(document);
        const config = vscode.workspace.getConfiguration('editor.inlineSuggest', { uri: document.uri, languageId: document.languageId });
        const previous = config.inspect<boolean>('enabled')?.globalLanguageValue;
        try {
            await config.update('enabled', false, vscode.ConfigurationTarget.Global, true);
            const scoped = () => vscode.workspace.getConfiguration('editor.inlineSuggest', { uri: document.uri, languageId: document.languageId });
            assert.strictEqual(scoped().get<boolean>('enabled'), false);
            const panel = Object.create(StatusBarPanel.prototype) as StatusBarPanel;
            await (panel as unknown as { _enableEditorInlineSuggestions(): Promise<void> })._enableEditorInlineSuggestions();
            assert.strictEqual(scoped().get<boolean>('enabled'), true);
        } finally {
            await config.update('enabled', previous, vscode.ConfigurationTarget.Global, true);
        }
    });


    test('does not advertise cursor prediction while NES is disabled', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const value = 1;' });
        await vscode.window.showTextDocument(document);
        const panel = new StatusBarPanel(
            { enabled: false } as never,
            { enabled: false, nextCursorPredictionEnabled: true } as never,
            {} as never, {} as never, {} as never,
        );
        const statusBar = (panel as unknown as { _statusBarItem: vscode.StatusBarItem })._statusBarItem;
        try {
            assert.strictEqual(statusBar.text, '$(copilot-blocked) Completions');
        } finally {
            statusBar.dispose();
        }
    });

    test('shows setup state for an enabled model without an API endpoint', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const value = 1;' });
        await vscode.window.showTextDocument(document);
        const panel = new StatusBarPanel(
            { enabled: true, endpointConfigured: false } as never,
            { enabled: false, nextCursorPredictionEnabled: false } as never,
            {} as never, {} as never, {} as never,
        );
        const statusBar = (panel as unknown as { _statusBarItem: vscode.StatusBarItem })._statusBarItem;
        try {
            assert.strictEqual(statusBar.text, '$(copilot-warning) Completions');
            assert.ok(statusBar.tooltip?.toString().includes('ghost.baseUrl'));
        } finally {
            statusBar.dispose();
        }
    });

    test('shows an excluded source file as unavailable', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-status-'));
        const filePath = path.join(tempDir, 'status-excluded.ts');
        const config = vscode.workspace.getConfiguration('cc-completion');
        const previous = config.inspect<string[]>('exclude')?.globalValue;
        let statusBar: vscode.StatusBarItem | undefined;
        try {
            await fs.writeFile(filePath, 'const value = 1;');
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(document);
            await config.update('exclude', ['**/status-excluded.ts'], vscode.ConfigurationTarget.Global);
            const panel = new StatusBarPanel(
                { enabled: true } as never,
                { enabled: true, nextCursorPredictionEnabled: false } as never,
                {} as never, {} as never, {} as never,
            );
            statusBar = (panel as unknown as { _statusBarItem: vscode.StatusBarItem })._statusBarItem;
            assert.strictEqual(statusBar.text, '$(copilot-not-connected) Completions');
            assert.ok(statusBar.tooltip?.toString().includes('excluded for this file'));
        } finally {
            statusBar?.dispose();
            await config.update('exclude', previous, vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    });
});
