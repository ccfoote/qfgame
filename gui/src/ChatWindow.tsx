/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hyperlink, SmallIconButton } from "@fi-sci/misc";
import ModalWindow, { useModalWindow } from "@fi-sci/modal-window";
import Markdown from "./Markdown";
import AgentProgressWindow, {
  AgentProgressMessage,
} from "./Chat/AgentProgressWindow";
import { Chat, ChatAction } from "./Chat/Chat";
import chatCompletion from "./Chat/chatCompletion";
import InputBar from "./Chat/InputBar";
import MessageDisplay from "./Chat/MessageDisplay";
import {
  ORMessage,
  ORToolCall,
} from "./Chat/openRouterTypes";
import SettingsBar from "./Chat/SettingsBar";
import ToolElement from "./Chat/ToolElement";
import { ToolItem } from "./Chat/ToolItem";
import ToolResponseView from "./Chat/ToolResponseView";
import {
  FunctionComponent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ChatWindowProps = {
  width: number;
  height: number;
  chat: Chat;
  chatDispatch: (action: ChatAction) => void;
  openRouterKey: string | null;
  score: number;
  setScore: (score: number) => void;
};

const ChatWindow: FunctionComponent<
  ChatWindowProps
> = ({
  width,
  height,
  chat,
  chatDispatch,
  openRouterKey,
  setScore
}) => {
  // define the tools
  const tools: ToolItem[] = useMemo(() => {
    const ret: ToolItem[] = [];
    // ret.push(dandisetObjectsTool);
    // ret.push(neurodataTypesTool);
    // ret.push(probeDandisetTool);
    // ret.push(timeseriesAlignmentViewTool);
    // ret.push(probeNwbFileTool);
    // ret.push(
    //   editContributorsTool((obj) => {
    //     setEditedDandisetMetadata((old) =>
    //       old ? { ...old, contributor: obj.contributor } : null,
    //     );
    //   }),
    // );
    return ret;
  }, []);
  const initialMessage = useMemo(() => {
    return `
Welcome! This app is designed to help you become more familiar with the solar system through interactive learning.

You’ll be presented with different questions related to the solar system.
After each response, you’ll receive a score between -2 and 2, along with personalized feedback to help you grow as a solar system expert.

To get started, let me know the difficulty level you want to work at:

very easy, easy, medium, difficult, or very difficult.
`;
  }, []);
  const systemMessage = useSystemMessage(tools, initialMessage);
  // initial message at the top of the chat window
  useEffect(() => {
    setScore(computeScoreFromChat(chat));
  }, [chat, setScore]);
  return (
    <EditContributorsChatWindowChild
      width={width}
      height={height}
      chat={chat}
      chatDispatch={chatDispatch}
      openRouterKey={openRouterKey}
      systemMessage={systemMessage}
      tools={tools}
      initialMessage={initialMessage}
    />
  );
};

const EditContributorsChatWindowChild: FunctionComponent<{
  width: number;
  height: number;
  chat: Chat;
  chatDispatch: (action: ChatAction) => void;
  openRouterKey: string | null;
  systemMessage: string;
  tools: ToolItem[];
  initialMessage: string;
}> = ({
  width,
  height,
  chat,
  chatDispatch,
  openRouterKey,
  systemMessage,
  tools,
  initialMessage,
}) => {
  const inputBarHeight = 30;
  const settingsBarHeight = 20;
  const topBarHeight = 24;

  const [modelName, setModelName] = useState("openai/gpt-4o");

  const handleUserMessage = useCallback(
    (message: string) => {
      chatDispatch({
        type: "add-message",
        message: { role: "user", content: message },
      });
      setAtLeastOneUserMessageSubmitted(true);
    },
    [chatDispatch],
  );

  const messages = chat.messages;

  // last message
  const lastMessage = useMemo(() => {
    const messages2: ORMessage[] = [
      ...messages.filter((x) => x.role !== "client-side-only"),
    ];
    if (messages2.length === 0) return null;
    return messages2[messages2.length - 1];
  }, [messages]);

  // last message is user or tool
  const lastMessageIsUserOrTool = useMemo(() => {
    return lastMessage
      ? lastMessage.role === "user" || lastMessage.role === "tool"
      : false;
  }, [lastMessage]);

  // last message is tool calls
  const lastMessageIsToolCalls = useMemo(() => {
    return lastMessage
      ? !!(
          lastMessage.role === "assistant" &&
          lastMessage.content === null &&
          lastMessage.tool_calls
        )
      : false;
  }, [lastMessage]);

//   // last message is assistant non-tool call
//   const lastMessageIsAssistantNonToolCall = useMemo(() => {
//     return lastMessage
//       ? lastMessage.role === "assistant" && !(lastMessage as any).tool_calls
//       : false;
//   }, [lastMessage]);

  // has no user messages
  const hasNoUserMessages = useMemo(() => {
    return !messages.some((x) => x.role === "user");
  }, [messages]);

  const [editedPromptText, setEditedPromptText] = useState("");

  // backup and erase last user message
  const backUpAndEraseLastUserMessage = useCallback(() => {
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }
    if (lastUserMessageIndex === -1) {
      return;
    }
    const lastUserMessageContent = messages[lastUserMessageIndex].content;
    chatDispatch({
      type: "truncate-messages",
      lastMessage: messages[lastUserMessageIndex - 1] || null,
    });
    if (typeof lastUserMessageContent === "string") {
      setEditedPromptText(lastUserMessageContent);
    }
  }, [messages, chatDispatch]);

  // agent progress
  const [agentProgress, setAgentProgress] = useState<AgentProgressMessage[]>(
    [],
  );
  const resetAgentProgress = useCallback(() => {
    setAgentProgress([]);
  }, []);
  const addAgentProgressMessage = useCallback(
    (type: "stdout" | "stderr", message: string) => {
      setAgentProgress((prev) => [
        ...prev,
        {
          type,
          message,
        },
      ]);
    },
    [],
  );

  // last completion failed
  const [lastCompletionFailed, setLastCompletionFailed] = useState(false);
  const [lastCompletionFailedRefreshCode, setLastCompletionFailedRefreshCode] =
    useState(0);

  // Last message is user or tool, so we need to do a completion
  useEffect(() => {
    if (!systemMessage) return;
    let canceled = false;
    const messages2: ORMessage[] = [
      {
        role: "system",
        content: systemMessage,
      },
      ...messages.filter((x) => x.role !== "client-side-only"),
    ];
    const lastMessage = messages2[messages2.length - 1];
    if (!lastMessage) return;
    if (!["user", "tool"].includes(lastMessage.role)) return;
    (async () => {
      setLastCompletionFailed(false);
      let assistantMessage: string;
      let toolCalls: any[] | undefined;
      try {
        const x = await chatCompletion({
          messages: messages2,
          modelName,
          openRouterKey,
          tools: tools.map((x) => x.tool),
        });
        assistantMessage = x.assistantMessage;
        toolCalls = x.toolCalls;
      } catch (e: any) {
        if (canceled) return;
        console.warn("Error in chat completion", e);
        setLastCompletionFailed(true);
        return;
      }
      if (canceled) return;
      if (toolCalls) {
        // tool calls
        chatDispatch({
          type: "add-message",
          message: {
            role: "assistant",
            content: assistantMessage || null,
            tool_calls: toolCalls,
          },
        });
      } else {
        if (!assistantMessage) {
          console.warn("Unexpected: no assistant message and no tool calls");
          return;
        }
        chatDispatch({
          type: "add-message",
          message: { role: "assistant", content: assistantMessage },
        });
      }
    })();
    return () => {
      canceled = true;
    };
  }, [
    messages,
    modelName,
    openRouterKey,
    tools,
    systemMessage,
    backUpAndEraseLastUserMessage,
    chatDispatch,
    lastCompletionFailedRefreshCode,
  ]);

  // pending tool calls
  const [pendingToolCalls, setPendingToolCalls] = useState<ORToolCall[]>([]);

  const runningToolCalls = useRef(false);

  // last message is assistant with tool calls, so we need to run the tool calls
  useEffect(() => {
    if (!systemMessage) return;
    let canceled = false;
    const messages2: ORMessage[] = [
      {
        role: "system",
        content: systemMessage,
      },
      ...messages.filter((x) => x.role !== "client-side-only"),
    ];
    const lastMessage = messages2[messages2.length - 1];
    if (!lastMessage) return;
    if (lastMessage.role !== "assistant") return;
    if (!(lastMessage as any).tool_calls) return;
    if (runningToolCalls.current) return;
    (async () => {
      const newMessages: ORMessage[] = [];
      const toolCalls: ORToolCall[] = (lastMessage as any).tool_calls;
      const processToolCall = async (tc: any) => {
        const func = tools.find(
          (x) => x.tool.function.name === tc.function.name,
        )?.function;
        if (!func) {
          throw Error(`Unexpected. Did not find tool: ${tc.function.name}`);
        }
        const args = JSON.parse(tc.function.arguments);
        console.info("TOOL CALL: ", tc.function.name, args, tc);
        let response: string;
        try {
          addAgentProgressMessage(
            "stdout",
            `Running tool: ${tc.function.name}`,
          );
          console.info(`Running ${tc.function.name}`);
          response = await func(args, () => {}, {
            modelName,
            openRouterKey
          });
        } catch (e: any) {
          console.error(`Error in tool ${tc.function.name}`, e);
          // errorMessage = e.message;
          response = "Error: " + e.message;
        }
        if (canceled) {
          console.warn(
            `WARNING!!! Hook canceled during tool call ${tc.function.name}`,
          );
          return;
        }
        console.info("TOOL RESPONSE: ", response);
        const msg1: ORMessage = {
          role: "tool",
          content:
            typeof response === "object"
              ? JSON.stringify(response)
              : `${response}`,
          tool_call_id: tc.id,
        };
        newMessages.push(msg1);
      };
      // run the tool calls in parallel
      resetAgentProgress();
      runningToolCalls.current = true;
      try {
        setPendingToolCalls(toolCalls);
        const toolItems = toolCalls.map((tc) =>
          tools.find((x) => x.tool.function.name === tc.function.name),
        );
        const serialIndices = toolItems
          .map((x, i) => ({ x, i }))
          .filter((a) => a.x?.serial)
          .map((a) => a.i);
        const nonSerialIndices = toolItems
          .map((x, i) => ({ x, i }))
          .filter((a) => !a.x?.serial)
          .map((a) => a.i);
        for (const i of serialIndices) {
          await processToolCall(toolCalls[i]);
        }
        await Promise.all(
          toolCalls
            .filter((_, i) => nonSerialIndices.includes(i))
            .map(processToolCall),
        );
      } finally {
        runningToolCalls.current = false;
        setPendingToolCalls([]);
        resetAgentProgress();
      }
      if (canceled) return;
      chatDispatch({
        type: "add-messages",
        messages: newMessages,
      });
    })();
    return () => {
      canceled = true;
    };
  }, [
    messages,
    modelName,
    openRouterKey,
    tools,
    systemMessage,
    chatDispatch,
    resetAgentProgress,
    addAgentProgressMessage,
  ]);

  // div refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const bottomElementRef = useRef<HTMLDivElement>(null);

  // at least one user message submitted in this user session
  const [atLeastOneUserMessageSubmitted, setAtLeastOneUserMessageSubmitted] =
    useState(false);

  // whether the input bar is enabled
  const inputBarEnabled = useMemo(() => {
    return !lastMessageIsUserOrTool && !lastMessageIsToolCalls;
  }, [lastMessageIsUserOrTool, lastMessageIsToolCalls]);

  // suggested questions depending on the context
  const suggestedQuestions = useMemo(() => {
    return [];
  }, []);
  const handleClickSuggestedQuestion = useCallback(
    (question: string) => {
      if (!inputBarEnabled) {
        return;
      }
      chatDispatch({
        type: "add-message",
        message: { role: "user", content: question },
      });
      setAtLeastOneUserMessageSubmitted(true);
    },
    [chatDispatch, inputBarEnabled],
  );

  // layout
  const chatAreaWidth = Math.min(width - 30, 800);
  const offsetLeft = (width - chatAreaWidth) / 2;

  // when a new message comes, scroll to the bottom
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    if (!atLeastOneUserMessageSubmitted) {
      return;
    }
    const lastMessage = messages[messages.length - 1];
    if (!["assistant", "client-side-only"].includes(lastMessage.role)) {
      return;
    }
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages, atLeastOneUserMessageSubmitted]);

  // truncate at a particular message
  const truncateAtMessage = useCallback(
    (m: ORMessage) => {
      const index = messages.indexOf(m);
      if (index < 0) return;
      chatDispatch({
        type: "truncate-messages",
        lastMessage: messages[index - 1] || null,
      });
    },
    [messages, chatDispatch],
  );

  // open window to see the data for a tool response
  const [openToolResponseData, setOpenToolResponseData] = useState<{
    toolCall: ORToolCall;
    toolResponse: ORMessage;
  } | null>(null);
  const {
    handleOpen: openToolResponse,
    handleClose: closeToolResponse,
    visible: toolResponseVisible,
  } = useModalWindow();
  const handleOpenToolResponse = useCallback(
    (toolCall: ORToolCall, toolResponse: ORMessage) => {
      setOpenToolResponseData({ toolCall, toolResponse });
      openToolResponse();
    },
    [openToolResponse],
  );

  const handleDownloadChat = useCallback(() => {
    // download to a .nschat file
    const blob = new Blob([JSON.stringify(chat, null, 2)], {
      type: "application/json",
    });
    const fileName = prompt("Enter a file name", "chat.nschat");
    if (!fileName) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [chat]);

  const handleUploadChat = useCallback(() => {
    // have user select a .nschat file from their machine and load it
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".nschat";
    input.onchange = async () => {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const text = await file.text();
      const chat2 = JSON.parse(text);
      chatDispatch({ type: "set", chat: chat2 });
    };
    input.click();
  }, [chatDispatch]);

  return (
    <div
      style={{
        position: "relative",
        left: offsetLeft,
        width: chatAreaWidth,
        height,
      }}
    >
      <div
        ref={chatContainerRef}
        style={{
          position: "absolute",
          left: 5,
          width: chatAreaWidth - 10,
          top: topBarHeight,
          height: height - topBarHeight - inputBarHeight - settingsBarHeight,
          overflow: "auto",
        }}
      >
        <div>
          <Markdown source={initialMessage} />
        </div>
        {suggestedQuestions.length > 0 && hasNoUserMessages && (
          <div style={{ marginTop: 5, marginBottom: 5 }}>
            {suggestedQuestions.map((question, index) => (
              <span key={index}>
                {index > 0 && <br />}
                <span
                  style={{
                    marginLeft: 0,
                    marginRight: 5,
                    cursor: inputBarEnabled ? "pointer" : undefined,
                    color: inputBarEnabled ? "#aaf" : "lightgray",
                  }}
                  onClick={() => handleClickSuggestedQuestion(question)}
                >
                  {question}
                </span>
              </span>
            ))}
          </div>
        )}
        {messages
          .filter((m) => {
            if (m.role === "assistant" && m.content === null) {
              return false;
            }
            return true;
          })
          .map((c, index) => (
            <div
              key={index}
              style={{
                color: colorForRole(c.role),
              }}
            >
              {c.role === "assistant" && c.content !== null ? (
                <>
                  <Markdown source={c.content as string} />
                </>
              ) : c.role === "assistant" && !!(c as any).tool_calls ? (
                <>
                  <div>Tool calls</div>
                </>
              ) : c.role === "user" ? (
                <>
                  <hr />
                  <span style={{ color: "darkblue" }}>YOU: </span>
                  <span style={{ color: "darkblue" }}>
                    <MessageDisplay message={c.content as string} />
                    &nbsp;
                    <SmallIconButton
                      onClick={() => {
                        const ok = confirm(
                          "Delete this prompt and all subsequent messages?",
                        );
                        if (!ok) return;
                        truncateAtMessage(c);
                      }}
                      icon={<span>...</span>}
                      title="Delete this prompt"
                    />
                  </span>
                  <hr />
                </>
              ) : c.role === "tool" ? (
                <div>
                  <ToolElement
                    message={c}
                    messages={messages}
                    onOpenToolResponse={(toolCall, toolResponse) => {
                      handleOpenToolResponse(toolCall, toolResponse);
                    }}
                  />
                </div>
              ) : c.role === "client-side-only" ? (
                <>
                  <div
                    style={{
                      color: (c as any).color || "#6a6",
                      paddingBottom: 10,
                    }}
                  >
                    {(c as any).content}
                  </div>
                </>
              ) : (
                <span>Unknown role: {c.role}</span>
              )}
            </div>
          ))}
        {(lastMessageIsUserOrTool || lastMessageIsToolCalls) && (
          <div>
            <span style={{ color: "#6a6" }}>processing...</span>
          </div>
        )}
        {pendingToolCalls.length > 0 && (
          <div>
            {pendingToolCalls.length === 1
              ? `Processing tool call: ${pendingToolCalls[0].function.name}`
              : `Processing ${pendingToolCalls.length} tool calls: ${pendingToolCalls.map((x) => x.function.name).join(", ")}`}
          </div>
        )}
        {agentProgress.length > 0 && (
          <AgentProgressWindow
            width={chatAreaWidth - 10}
            height={400}
            agentProgress={agentProgress}
          />
        )}
        {lastCompletionFailed && (
          <div>
            <span style={{ color: "red" }}>
              {`An error occurred retrieving the assistant's response. `}
              <Hyperlink
                onClick={() => {
                  setLastCompletionFailedRefreshCode((x) => x + 1);
                }}
              >
                Try again
              </Hyperlink>
            </span>
          </div>
        )}
        <div ref={bottomElementRef}>&nbsp;</div>
      </div>
      <div
        style={{
          position: "absolute",
          width: chatAreaWidth,
          height: inputBarHeight,
          top: height - inputBarHeight - settingsBarHeight,
          left: 0,
        }}
      >
        <InputBar
          width={chatAreaWidth}
          height={inputBarHeight}
          onMessage={handleUserMessage}
          disabled={!inputBarEnabled}
          waitingForResponse={lastMessageIsUserOrTool || lastMessageIsToolCalls}
          editedPromptText={editedPromptText}
          setEditedPromptText={setEditedPromptText}
        />
      </div>
      <div
        style={{
          position: "absolute",
          width,
          height: settingsBarHeight,
          top: height - settingsBarHeight,
          left: 0,
        }}
      >
        <SettingsBar
          width={width}
          height={settingsBarHeight}
          onClearAllMessages={() => {
            chatDispatch({
              type: "clear-messages",
            });
          }}
          modelName={modelName}
          setModelName={setModelName}
          onDownloadChat={handleDownloadChat}
          onUploadChat={handleUploadChat}
        />
      </div>
      <ModalWindow visible={toolResponseVisible} onClose={closeToolResponse}>
        {openToolResponseData ? (
          <ToolResponseView
            toolCall={openToolResponseData.toolCall}
            toolResponse={openToolResponseData.toolResponse}
          />
        ) : (
          <span>Unexpected: no tool response data</span>
        )}
      </ModalWindow>
    </div>
  );
};

const colorForRole = (role: string) => {
  // for now we do it randomly and see how it looks
  const hash = role.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const r = hash % 200;
  const g = (hash * 2) % 200;
  const b = (hash * 3) % 200;
  return `rgb(${r},${g},${b})`;
};

const useSystemMessage = (
  tools: ToolItem[],
  initialMessage: string,
) => {
  let systemMessage = `
You are going to ask the user questions to quiz them based on their knowledge of the solar system.
Each question will be short and will describe give some context and ask the user something. It should be an open-ended question, not just reciting a fact, but something they will need to respond with no more than a sentence.
Then you will judge the answer based on the values.
If the answer is irrelevant to the question, then you will respond politely that it is irrelevant and prompt them to try again.
You will give a score between -2 and 2 where -2 is the worst (least correct) and 2 is the best (most correct and most thorough).
Tell the user the score, give them some very helpful feedback (perhaps additional information), and then proceed to the next question. You shouldn't require a prompt from the user in order to proceed with the next question.
When you tell the score, include it in square brackets like this: [-1], [0], [1], etc. That way the system can detect the score and tally the results.
You should stick to only information relevant to the solar system as described below and you should judge only based on the information below.
You can use other general knowledge for background, but no other facts should be considered in the scoring.
The first user message will be a response to the following initial prompt: ${initialMessage}
If the user seems to intentially be trying to get a low score and being disrespectful, you can end the conversation politely.
You should adhere to the user's difficulty level request. If they ask for easy questions, then make sure the questions are very easy.

Here is the information about the solar system to draw from:
The Solar System[d] is the gravitationally bound system of the Sun and the objects that orbit it.[11] It formed about 4.6 billion years ago when a dense region of a molecular cloud collapsed, forming the Sun and a protoplanetary disc. The Sun is a typical star that maintains a balanced equilibrium by the fusion of hydrogen into helium at its core, releasing this energy from its outer photosphere. Astronomers classify it as a G-type main-sequence star.

The largest objects that orbit the Sun are the eight planets. In order from the Sun, they are four terrestrial planets (Mercury, Venus, Earth and Mars); two gas giants (Jupiter and Saturn); and two ice giants (Uranus and Neptune). All terrestrial planets have solid surfaces. Inversely, all giant planets do not have a definite surface, as they are mainly composed of gases and liquids. Over 99.86% of the Solar System's mass is in the Sun and nearly 90% of the remaining mass is in Jupiter and Saturn.

There is a strong consensus among astronomers[e] that the Solar System has at least nine dwarf planets: Ceres, Orcus, Pluto, Haumea, Quaoar, Makemake, Gonggong, Eris, and Sedna. There are a vast number of small Solar System bodies, such as asteroids, comets, centaurs, meteoroids, and interplanetary dust clouds. Some of these bodies are in the asteroid belt (between Mars's and Jupiter's orbit) and the Kuiper belt (just outside Neptune's orbit).[f] Six planets, seven dwarf planets, and other bodies have orbiting natural satellites, which are commonly called 'moons'.

The Solar System is constantly flooded by the Sun's charged particles, the solar wind, forming the heliosphere. Around 75–90 astronomical units from the Sun,[g] the solar wind is halted, resulting in the heliopause. This is the boundary of the Solar System to interstellar space. The outermost region of the Solar System is the theorized Oort cloud, the source for long-period comets, extending to a radius of 2,000–200,000 AU. The closest star to the Solar System, Proxima Centauri, is 4.25 light-years (269,000 AU) away. Both stars belong to the Milky Way galaxy.

Astronomers sometimes divide the Solar System structure into separate regions. The inner Solar System includes Mercury, Venus, Earth, Mars, and the bodies in the asteroid belt. The outer Solar System includes Jupiter, Saturn, Uranus, Neptune, and the bodies in the Kuiper belt.[35] Since the discovery of the Kuiper belt, the outermost parts of the Solar System are considered a distinct region consisting of the objects beyond Neptune.[36]

The principal component of the Solar System is the Sun, a G-type main-sequence star that contains 99.86% of the system's known mass and dominates it gravitationally.[37] The Sun's four largest orbiting bodies, the giant planets, account for 99% of the remaining mass, with Jupiter and Saturn together comprising more than 90%. The remaining objects of the Solar System (including the four terrestrial planets, the dwarf planets, moons, asteroids, and comets) together comprise less than 0.002% of the Solar System's total mass.[h]

The Sun is composed of roughly 98% hydrogen and helium,[41] as are Jupiter and Saturn.[42][43] A composition gradient exists in the Solar System, created by heat and light pressure from the early Sun; those objects closer to the Sun, which are more affected by heat and light pressure, are composed of elements with high melting points. Objects farther from the Sun are composed largely of materials with lower melting points.[44] The boundary in the Solar System beyond which those volatile substances could coalesce is known as the frost line, and it lies at roughly five times the Earth's distance from the Sun.[5]
`;
  for (const tool of tools) {
    if (tool.detailedDescription) {
      systemMessage += `
      ========================
      Here's a detailed description of the ${tool.tool.function.name} tool:
      ${tool.detailedDescription}
      ========================
      `;
    }
  }
  return systemMessage;
};

const computeScoreFromChat = (chat: Chat) => {
    let s = 0;
    for (const msg of chat.messages) {
        if (msg.role === "assistant") {
            const txt = msg.content as string;
            const m = txt.match(/\[(-?\d+)\]/);
            if (m) {
                const v = parseInt(m[1]);
                if (!isNaN(v)) {
                    if ((-2 <= v) && (v <= 2)) {
                        s += v;
                    }
                }
            }
        }
    }
    return s;
}

export default ChatWindow;
