// The subset of the Chrome DevTools Protocol the local browser uses. Hand-written so the server
// plugin does not depend on the generated `devtools-protocol` package.

export type Headers = Record<string, string>

export type RemoteObject = {
  type: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  objectId?: string
}

export type ExceptionDetails = {
  text: string
  lineNumber: number
  columnNumber: number
  url?: string
  exception?: RemoteObject
}

export type Evaluated = { result: RemoteObject; exceptionDetails?: ExceptionDetails }

export type TargetInfo = {
  targetId: string
  type: string
  title: string
  url: string
  attached: boolean
  parentFrameId?: string
}

export type Frame = { id: string; parentId?: string; url: string; name?: string }
export type FrameTree = { frame: Frame; childFrames?: FrameTree[] }

export type AXValue = { type: string; value?: unknown }
export type AXNode = {
  nodeId: string
  ignored: boolean
  role?: AXValue
  name?: AXValue
  properties?: { name: string; value: AXValue }[]
  childIds?: string[]
  backendDOMNodeId?: number
}

export type Rect = { x: number; y: number; width: number; height: number }

export type NetworkRequest = {
  url: string
  method: string
  headers: Headers
  postData?: string
  hasPostData?: boolean
}

export type NetworkResponse = { status: number; headers: Headers; mimeType: string }

export type CallFrame = { url: string; lineNumber: number; columnNumber: number }

export interface Commands {
  "Target.createTarget": { params: { url: string; background?: boolean }; result: { targetId: string } }
  "Target.closeTarget": { params: { targetId: string }; result: { success: boolean } }
  "Target.attachToTarget": { params: { targetId: string; flatten: true }; result: { sessionId: string } }
  "Target.getTargetInfo": { params: { targetId: string }; result: { targetInfo: TargetInfo } }
  "Target.activateTarget": { params: { targetId: string }; result: object }
  "Target.setAutoAttach": {
    params: {
      autoAttach: boolean
      waitForDebuggerOnStart: boolean
      flatten: boolean
      filter?: { type?: string; exclude?: boolean }[]
    }
    result: object
  }
  "Page.enable": { params: object; result: object }
  "Page.navigate": { params: { url: string }; result: { frameId: string; loaderId?: string; errorText?: string } }
  "Page.getNavigationHistory": {
    params: object
    result: { currentIndex: number; entries: { id: number; url: string; title: string }[] }
  }
  "Page.navigateToHistoryEntry": { params: { entryId: number }; result: object }
  "Page.reload": { params: object; result: object }
  "Page.stopLoading": { params: object; result: object }
  "Page.getFrameTree": { params: object; result: { frameTree: FrameTree } }
  "Page.getLayoutMetrics": {
    params: object
    result: {
      cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number }
      cssContentSize: Rect
    }
  }
  "Page.captureScreenshot": {
    params: { format: string; quality?: number; captureBeyondViewport: boolean; clip: Rect & { scale: number } }
    result: { data: string }
  }
  "Page.handleJavaScriptDialog": { params: { accept: boolean; promptText?: string }; result: object }
  "Page.bringToFront": { params: object; result: object }
  "Emulation.setFocusEmulationEnabled": { params: { enabled: boolean }; result: object }
  "DOM.enable": { params: object; result: object }
  "DOM.resolveNode": { params: { backendNodeId: number }; result: { object: RemoteObject } }
  "DOM.scrollIntoViewIfNeeded": { params: { backendNodeId: number }; result: object }
  "DOM.getFrameOwner": { params: { frameId: string }; result: { backendNodeId: number } }
  "DOM.focus": { params: { backendNodeId: number }; result: object }
  "DOM.setFileInputFiles": { params: { files: string[]; backendNodeId: number }; result: object }
  "Runtime.enable": { params: object; result: object }
  "Runtime.runIfWaitingForDebugger": { params: object; result: object }
  "Runtime.evaluate": {
    params: {
      expression: string
      contextId?: number
      awaitPromise?: boolean
      returnByValue?: boolean
      userGesture?: boolean
    }
    result: Evaluated
  }
  "Runtime.callFunctionOn": {
    params: {
      objectId: string
      functionDeclaration: string
      arguments?: ({ value: unknown } | { objectId: string })[]
      awaitPromise?: boolean
      returnByValue?: boolean
      userGesture?: boolean
    }
    result: Evaluated
  }
  "Runtime.releaseObject": { params: { objectId: string }; result: object }
  "Accessibility.getFullAXTree": { params: { frameId?: string; depth?: number }; result: { nodes: AXNode[] } }
  "Input.dispatchMouseEvent": {
    params: {
      type: string
      x: number
      y: number
      button?: string
      buttons?: number
      clickCount?: number
      modifiers?: number
      deltaX?: number
      deltaY?: number
    }
    result: object
  }
  "Input.dispatchKeyEvent": {
    params: { type: string; key: string; windowsVirtualKeyCode: number; modifiers: number; text?: string }
    result: object
  }
  "Input.insertText": { params: { text: string }; result: object }
  "Input.dispatchDragEvent": {
    params: {
      type: string
      x: number
      y: number
      data: { items: { mimeType: string; data: string }[]; files?: string[]; dragOperationsMask: number }
    }
    result: object
  }
  "Log.enable": { params: object; result: object }
  "Network.enable": {
    params: { maxTotalBufferSize: number; maxResourceBufferSize: number; maxPostDataSize: number }
    result: object
  }
  "Network.getResponseBody": { params: { requestId: string }; result: { body: string; base64Encoded: boolean } }
}

export interface Events {
  "Target.attachedToTarget": { sessionId: string; targetInfo: TargetInfo; waitingForDebugger: boolean }
  "Target.detachedFromTarget": { sessionId: string }
  "Target.targetDestroyed": { targetId: string }
  "Target.targetCrashed": { targetId: string }
  "Inspector.detached": { reason: string }
  "Page.frameNavigated": { frame: Frame }
  "Page.frameDetached": { frameId: string }
  "Page.frameStartedLoading": { frameId: string }
  "Page.frameStoppedLoading": { frameId: string }
  "Page.javascriptDialogOpening": { url: string; message: string; type: string; defaultPrompt?: string }
  "Page.javascriptDialogClosed": { result: boolean }
  "Runtime.executionContextCreated": {
    context: { id: number; auxData?: { frameId?: string; isDefault?: boolean } }
  }
  "Runtime.executionContextDestroyed": { executionContextId: number }
  "Runtime.executionContextsCleared": object
  "Runtime.consoleAPICalled": {
    type: string
    args: RemoteObject[]
    timestamp: number
    stackTrace?: { callFrames: CallFrame[] }
  }
  "Runtime.exceptionThrown": { timestamp: number; exceptionDetails: ExceptionDetails }
  "Log.entryAdded": {
    entry: { level: "verbose" | "info" | "warning" | "error"; text: string; timestamp: number; url?: string; lineNumber?: number }
  }
  "Network.requestWillBeSent": {
    requestId: string
    request: NetworkRequest
    timestamp: number
    wallTime: number
    type?: string
    redirectResponse?: NetworkResponse
    redirectHasExtraInfo?: boolean
  }
  "Network.requestWillBeSentExtraInfo": { requestId: string; headers: Headers }
  "Network.responseReceived": { requestId: string; response: NetworkResponse; hasExtraInfo?: boolean }
  "Network.responseReceivedExtraInfo": { requestId: string; headers: Headers; statusCode: number }
  "Network.loadingFinished": { requestId: string; timestamp: number }
  "Network.loadingFailed": { requestId: string; timestamp: number; errorText: string }
  "Network.webSocketCreated": { requestId: string; url: string }
  "Network.webSocketWillSendHandshakeRequest": {
    requestId: string
    timestamp: number
    wallTime: number
    request: { headers: Headers }
  }
  "Network.webSocketHandshakeResponseReceived": { requestId: string; timestamp: number; response: NetworkResponse }
  "Network.webSocketFrameError": { requestId: string; timestamp: number; errorMessage: string }
  "Network.webSocketClosed": { requestId: string; timestamp: number }
}
