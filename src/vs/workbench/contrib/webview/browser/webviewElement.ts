/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from 'vs/base/browser/dom';
import { ThrottledDelayer } from 'vs/base/common/async';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { IRequestService } from 'vs/platform/request/common/request';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { BaseWebview, WebviewMessageChannels } from 'vs/workbench/contrib/webview/browser/baseWebviewElement';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { Webview, WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class IFrameWebview extends BaseWebview<HTMLIFrameElement> implements Webview {

	private _confirmBeforeClose: string;

	private readonly _focusDelayer = this._register(new ThrottledDelayer(10));
	private _elementFocusImpl!: (options?: FocusOptions | undefined) => void;

	constructor(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
		webviewThemeDataProvider: WebviewThemeDataProvider,
		@IConfigurationService configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService,
		@INotificationService notificationService: INotificationService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IRequestService requestService: IRequestService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ITunnelService tunnelService: ITunnelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
	) {
		super(id, options, contentOptions, extension, webviewThemeDataProvider, {
			notificationService,
			logService,
			telemetryService,
			environmentService,
			requestService,
			fileService,
			tunnelService,
			remoteAuthorityResolverService
		});

		/* __GDPR__
			"webview.createWebview" : {
				"extension": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"s": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		telemetryService.publicLog('webview.createWebview', {
			extension: extension?.id.value,
			webviewElementType: 'iframe',
		});

		this._confirmBeforeClose = configurationService.getValue<string>('window.confirmBeforeClose');

		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('window.confirmBeforeClose')) {
				this._confirmBeforeClose = configurationService.getValue('window.confirmBeforeClose');
				this._send(WebviewMessageChannels.setConfirmBeforeClose, this._confirmBeforeClose);
			}
		}));

		this.initElement(extension, options);
	}

	protected createElement(options: WebviewOptions, _contentOptions: WebviewContentOptions) {
		// Do not start loading the webview yet.
		// Wait the end of the ctor when all listeners have been hooked up.
		const element = document.createElement('iframe');
		element.className = `webview ${options.customClasses || ''}`;
		element.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-pointer-lock', 'allow-downloads');
		element.setAttribute('allow', 'clipboard-read; clipboard-write;');
		element.style.border = 'none';
		element.style.width = '100%';
		element.style.height = '100%';

		this._elementFocusImpl = () => element.contentWindow?.focus();
		element.focus = () => {
			this.doFocus();
		};

		return element;
	}

	protected initElement(extension: WebviewExtensionDescription | undefined, options: WebviewOptions, extraParams?: object) {
		const params = {
			id: this.id,
			extensionId: extension?.id.value ?? '', // The extensionId and purpose in the URL are used for filtering in js-debug:
			purpose: options.purpose,
			...extraParams
		} as const;

		const queryString = (Object.keys(params) as Array<keyof typeof params>)
			.map((key) => `${key}=${encodeURIComponent(params[key]!)}`)
			.join('&');

		this.element!.setAttribute('src', `${this.webviewContentEndpoint}/index.html?${queryString}`);
	}

	protected get webviewContentEndpoint(): string {
		const endpoint = this._environmentService.webviewExternalEndpoint!.replace('{{uuid}}', this.id);
		if (endpoint[endpoint.length - 1] === '/') {
			return endpoint.slice(0, endpoint.length - 1);
		}
		return endpoint;
	}

	protected get webviewResourceEndpoint(): string {
		return this.webviewContentEndpoint;
	}

	public mountTo(parent: HTMLElement) {
		if (this.element) {
			parent.appendChild(this.element);
		}
	}

	public set html(value: string) {
		super.html = this.preprocessHtml(value);
	}

	protected preprocessHtml(value: string): string {
		return value
			.replace(/(["'])(?:vscode-resource):(\/\/([^\s\/'"]+?)(?=\/))?([^\s'"]+?)(["'])/gi, (match, startQuote, _1, scheme, path, endQuote) => {
				if (scheme) {
					return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/${scheme}${path}${endQuote}`;
				}
				return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/file${path}${endQuote}`;
			})
			.replace(/(["'])(?:vscode-webview-resource):(\/\/[^\s\/'"]+\/([^\s\/'"]+?)(?=\/))?([^\s'"]+?)(["'])/gi, (match, startQuote, _1, scheme, path, endQuote) => {
				if (scheme) {
					return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/${scheme}${path}${endQuote}`;
				}
				return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/file${path}${endQuote}`;
			});
	}

	protected get extraContentOptions(): any {
		return {
			endpoint: this.webviewContentEndpoint,
			confirmBeforeClose: this._confirmBeforeClose,
		};
	}

	showFind(): void {
		throw new Error('Method not implemented.');
	}

	hideFind(): void {
		throw new Error('Method not implemented.');
	}

	runFindAction(previous: boolean): void {
		throw new Error('Method not implemented.');
	}

	protected doPostMessage(channel: string, data?: any): void {
		if (this.element) {
			this.element.contentWindow!.postMessage({ channel, args: data }, '*');
		}
	}

	protected on<T = unknown>(channel: WebviewMessageChannels, handler: (data: T) => void): IDisposable {
		return addDisposableListener(window, 'message', e => {
			if (!e || !e.data || e.data.target !== this.id) {
				return;
			}
			if (e.data.channel === channel) {
				handler(e.data.data);
			}
		});
	}

	public focus(): void {
		this.doFocus();

		// Handle focus change programmatically (do not rely on event from <webview>)
		this.handleFocusChange(true);
	}

	private doFocus() {
		if (!this.element) {
			return;
		}

		// Clear the existing focus first if not already on the webview.
		// This is required because the next part where we set the focus is async.
		if (document.activeElement && document.activeElement instanceof HTMLElement && document.activeElement !== this.element) {
			// Don't blur if on the webview because this will also happen async and may unset the focus
			// after the focus trigger fires below.
			document.activeElement.blur();
		}

		// Workaround for https://github.com/microsoft/vscode/issues/75209
		// Electron's webview.focus is async so for a sequence of actions such as:
		//
		// 1. Open webview
		// 1. Show quick pick from command palette
		//
		// We end up focusing the webview after showing the quick pick, which causes
		// the quick pick to instantly dismiss.
		//
		// Workaround this by debouncing the focus and making sure we are not focused on an input
		// when we try to re-focus.
		this._focusDelayer.trigger(async () => {
			if (!this.isFocused || !this.element) {
				return;
			}
			if (document.activeElement && document.activeElement?.tagName !== 'BODY') {
				return;
			}
			try {
				this._elementFocusImpl();
			} catch {
				// noop
			}
			this._send('focus');
		});
	}
}
