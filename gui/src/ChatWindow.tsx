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
Welcome! Are you a queer ally?

I'll ask some questions, and we'll see how LGBTQ-friendly you can be. The score for each question will be between -2 and 2.

Tell me a bit about yourself (your age, gender, any other helpful info) and then we'll get started!
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

  const [modelName, setModelName] = useState("anthropic/claude-3.5-sonnet");

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
  const chatAreaWidth = Math.min(width - 30, 1100);
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
You are going to as the user questions to quiz them based on certain values that will be provided below.
Each question will be short and will describe a scenario and ask the user what they would do in that scenario.
Then you will judge the answer based on the values.
If the answer is irrelevant to the scenario and the question, then you will respond politely that it is irrelevant and prompt them to try again.
You will give a score between -2 and 2 where -2 is the worst (least adherent to the values) and 2 is the best (most adherent to the values).
Tell the user the score, give a bit of feedback, and then proceed to the next question. You shouldn't require a prompt from the user in order to proceed with the next question.
When you tell the score, include it in square brackets like this: [-1], [0], [1], etc. That way the system can detect the score and tally the results.
You should stick to only scenarios relevant to the values described below and you should judge only based on the values below.
You can use other general knowledge for background, but no other values should be considered in the scoring.
The first user message will be a response to the following initial prompt: ${initialMessage}
If the user seems to intentially be trying to get a low score and being disrespectful, you can end the conversation politely.
If possible, try to cater the questions to the demographics of the user. However the scenarios should still always be relevant to the values below.

Here are the values:
7 EASY WAYS TO BE INCLUSIVE:
CREATING AN AFFIRMING ENVIRONMENT FOR LESBIAN, GAY,
BISEXUAL and TRANSGENDER MEMBERS OF THE ITHACA COLLEGE
COMMUNITY
#1- Know General Definitions
When talking about gender and sexual orientation, many people want to use correct
terminology, but don’t have useful definitions. This is especially true when
discussing gender. Remember that people use different criteria for identifying
these groups and that no one can assume another’s identity based on these
definitions. To get a general idea of the terms used to talk about gender and sexual
orientation, go to the LGBT resource center website in the resource section.
#2 – Include LGBT-themed flyers, posters and publications in your
classroom and office.
When you include LGBT-themed materials in your classroom and office without
drawing special attention to them, you help to create an atmosphere where LGBT
people do not feel excluded or singled out for their gender or sexual identities. For
example, hang a poster for an LGBT themed film festival the same way you would
hang a poster for an environmentally themed film festival. If you feel comfortable,
you can hang a safe space card in your office. Call the LGBT Center for more
information
#3- Use inclusive language at all times
Using inclusive language means talking in a way that does not specify a gender, sex,
or sexual orientation unless it is pertinent to the comment. For example, it is
unnecessary to point out that a student is a woman unless the comment is
specifically discussing the relevance of gender. You can also substitute the inclusive
terms, “partner” or “significant other” instead of specifying “husband/wife/spouse”.
Here are a few more examples for you to use:
• “are you dating anyone?” instead of “do you have a boyfriend/girlfriend?”
• “students turn in their papers” instead of “each student turn in his/her
paper”
• refer to the student’s “family” instead of “mom and dad” (this includes
students who may have single, step or LGBT parents or alternate guardians)
Park School of Communications*
#4 - Remember that you don’t know anyone’s sexual orientation or
gender identity unless they tell you
Lesbian, gay, bisexual, and transgender people come in all sizes, abilities, colors,
styles, political persuasions, religious affiliations, cultural backgrounds,
relationships statuses, educational histories and ages. In short, there is just as
much diversity among people who identify as LGBT as there is among those who
identify as heterosexual.
#5 - Have an inclusive curriculum.
It is important for all students to be able to relate to examples and case studies
used in the classroom. In professions where interviews and other forms of
communication are a focus, it is important that students learn to use inclusive
language. This will help students to build good rapport with the people they
interview and work with.
#6 - Confront comments that are heterosexist or gender identity
biased when you hear them.
Once you are educated about LGBT people, step in and educate others. Respond
when you hear others using non-inclusive language, making derogatory jokes, using
incorrect assumptions/stereotypes, voicing misinformation, etc. Tell them why you
think their comment was inappropriate and how they can improve it. Feel free to
give them a copy of the tip sheet!
#7 – Don’t let tension around sexual orientation or gender identity
continue to be unaddressed in your department because you’re not sure
that you know how to handle it.
 You are not alone in this process. There is help on campus. The Center for Lesbian,
Gay, Bisexual, & Transgender Education, Outreach and Services and the Office of
Human Resources have staff and resources to help you and your department work
through any issues that may arise.
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
