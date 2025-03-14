import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  Show,
  Suspense,
  createEffect,
  createResource,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { createStore } from "solid-js/store";
import "../styles.css";
import { CommandLog } from "./CommandLog";
import { CommandLogModal } from "./CommandLogModal";
import { SlidevStoreContext } from "./SlidevStoreContext";
import { createStartServerCommand } from "./createStartServerCommand";
import { GanttChartSquareIcon } from "./icons/GanttChartSquareIcon";
import { MonitorPlayIcon } from "./icons/MonitorPlayIcon";
import { RibbonButton } from "./icons/RibbonButton";
import { useApp } from "./useApp";
import { useSettings } from "./useSettings";

const localhost = () => "localhost"; //`127.0.0.1`;

async function fetchIsServerUp(serverBaseUrl: string): Promise<boolean> {
  try {
    const url = serverBaseUrl.endsWith('/') ? `${serverBaseUrl}index.html` : `${serverBaseUrl}/index.html`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    console.log(`Checking server status at: ${url}`);
    const response = await fetch(url, { 
      signal: controller.signal,
      cache: 'no-cache'
    });
    
    clearTimeout(timeoutId);
    
    return response.status < 500;
  } catch (error) {
    console.error("Error checking server status:", error);
    return false;
  }
}

let command: ChildProcessWithoutNullStreams | null = null;

export interface LogMessage {
  type: "error" | "message";
  value: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMessage(data: any) {
  return {
    type: "message" as const,
    value: String(data.toString()),
  };
}

function createError(value: string) {
  return { type: "error" as const, value };
}

function SlidevDebugHeader(props: {
  onStartServer: () => void;
  onStopServer: () => void;
  onOpenLog: () => void;
}) {
  return (
    <div class="sticky left-0 top-0 flex w-full items-center gap-3">
      <button
        type="button"
        onClick={() => {
          props.onStartServer();
        }}
      >
        Start
      </button>
      <button
        type="button"
        onClick={() => {
          props.onStopServer();
        }}
      >
        Stop
      </button>
      <button
        type="button"
        onClick={() => {
          props.onOpenLog();
        }}
      >
        Log
      </button>
    </div>
  );
}

function SlidevFallback(props: {
  commandLogMessages: Array<LogMessage>;
  slidevUrl: string;
  onStartServer: () => void;
  onShowLog: () => void;
}) {
  return (
    <div class="flex h-full items-center justify-center">
      <div class="flex flex-col items-center gap-4">
        <div class="text-xl text-red-400">Slidev server is down</div>
        <div>
          No server found at{" "}
          <a href={props.slidevUrl}>{props.slidevUrl}</a>
        </div>
        <div>
          <button
            type="button"
            onClick={() => {
              props.onStartServer();
            }}
          >
            Start slidev server
          </button>
        </div>
        <CommandLog messages={props.commandLogMessages} />
      </div>
    </div>
  );
}

function SlidevPresentation(props: {
  title: string;
  onOpenSlideUrl: () => void;
  onOpenSlidevPresenterUrl: () => void;
  src: string;
}) {
  return (
    <div class="flex h-full flex-col">
      <h4 class="flex items-center gap-2">
        <div class="flex-1">{props.title}</div>
        <div class="flex items-center gap-2">
          <RibbonButton
            label="Open presentation view"
            onClick={props.onOpenSlideUrl}
          >
            <MonitorPlayIcon />
          </RibbonButton>
          <RibbonButton
            label="Open presenter view"
            onClick={props.onOpenSlidevPresenterUrl}
          >
            <GanttChartSquareIcon />
          </RibbonButton>
        </div>
      </h4>

      <iframe
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation"
        title="Slidev presentation"
        class="size-full"
        id="iframe"
        src={props.src}
        allow="fullscreen"
      />
    </div>
  );
}

function killCommand() {
  if (command != null) {
    command.kill("SIGINT");
  }
}

export const PresentationView = () => {
  const app = useApp();
  const config = useSettings();
  const store = useContext(SlidevStoreContext);

  const [commandLogMessages, setCommandLogMessages] = createStore<
    Array<LogMessage>
  >([]);

  const serverBaseUrl = () => `http://${localhost()}:${config.port}/`;

  const [isServerUp, { refetch }] = createResource(
    serverBaseUrl,
    fetchIsServerUp,
  );

  createEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.currentSlideNumber;
    void refetch();
  });

  const commandLogModal = new CommandLogModal(app, commandLogMessages);

  const iframeSrcUrl = () => {
    return `${serverBaseUrl()}${store.currentSlideNumber}?embedded=true`;
  };

  function addLogListeners(command: ChildProcessWithoutNullStreams) {
    command.on("disconnect", () => {
      setCommandLogMessages([...commandLogMessages, createError("disconnect")]);
    });

    command.on("error", (error) => {
      setCommandLogMessages([
        ...commandLogMessages,
        createError(error.message),
      ]);
    });

    command.on("close", (code) => {
      setCommandLogMessages([
        ...commandLogMessages,
        createError(`child process exited with code ${String(code)}`),
      ]);
    });

    command.on("message", (message) => {
      setCommandLogMessages([...commandLogMessages, createMessage(message)]);
    });

    command.on("exit", (code, signal) => {
      const errorMessage = `child process exited with code ${String(
        code,
      )} and signal ${String(signal)}`;

      setCommandLogMessages([...commandLogMessages, createError(errorMessage)]);
    });

    command.stdout.on("data", (data) => {
      setCommandLogMessages([...commandLogMessages, createMessage(data)]);
    });

    command.stderr.on("data", (data) => {
      setCommandLogMessages([...commandLogMessages, createMessage(data)]);
    });
  }

  function startSlidevServer() {
    if (command != null) {
      command.kill("SIGINT");
    }

    command = createStartServerCommand({ app, config });

    addLogListeners(command);

    // 增加检测次数和间隔时间
    let attempts = 0;
    const maxAttempts = 30;
    const checkInterval = setInterval(() => {
      void refetch();
      attempts++;
      
      // 如果检测到服务器已启动或达到最大尝试次数，清除定时器
      if (isServerUp() || attempts >= maxAttempts) {
        clearInterval(checkInterval);
      }
    }, 1000);

    process.on("exit", () => {
      killCommand();
    });
  }

  onMount(() => {
    startSlidevServer();
  });

  onCleanup(() => {
    killCommand();
  });

  function handleOpenLog() {
    commandLogModal.open();
  }

  function handleStopServer() {
    if (command != null) {
      command.kill();
      void refetch();
    }
  }

  function handleOpenSlideUrl() {
    window.open(
      `${serverBaseUrl()}${store.currentSlideNumber}`,
      "noopener=true,noreferrer=true",
    );
  }

  function handleOpenSlidePresenterUrl() {
    window.open(
      `${serverBaseUrl()}presenter/${store.currentSlideNumber}`,
      "noopener=true,noreferrer=true",
    );
  }

  const title = () => {
    const activeFile = app.workspace.getActiveFile();
    const currentSlideFileName = activeFile == null ? "" : activeFile.basename;

    const slideNumber =
      store.currentSlideNumber === 0 ? "" : ` #${store.currentSlideNumber}`;

    return `${currentSlideFileName}${slideNumber}`;
  };

  return (
    <Suspense
      fallback={
        <div class="flex h-full items-center justify-center">
          Loading slidev slides
        </div>
      }
    >
      <div class="flex h-full flex-col">
        <Show when={config.isDebug}>
          <SlidevDebugHeader
            onStartServer={startSlidevServer}
            onStopServer={handleStopServer}
            onOpenLog={handleOpenLog}
          />
        </Show>
        <Show
          // when={isServerUp()}
          when={true}
          fallback={
            <SlidevFallback
              commandLogMessages={commandLogMessages}
              slidevUrl={serverBaseUrl()}
              onStartServer={startSlidevServer}
              onShowLog={handleOpenLog}
            />
          }
        >
          <SlidevPresentation
            title={title()}
            src={iframeSrcUrl()}
            onOpenSlideUrl={handleOpenSlideUrl}
            onOpenSlidevPresenterUrl={handleOpenSlidePresenterUrl}
          />
        </Show>
      </div>
    </Suspense>
  );
};
