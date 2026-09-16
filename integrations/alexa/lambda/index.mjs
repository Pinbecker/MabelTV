import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";

const endpoint = process.env.MABELTV_AWS_IOT_ENDPOINT;
const topic = process.env.MABELTV_AWS_IOT_COMMAND_TOPIC || "mabeltv/alexa/commands";
const client = new IoTDataPlaneClient({ endpoint: `https://${endpoint}` });

const reply = (text, endSession = true) => ({
  version: "1.0",
  response: { shouldEndSession: endSession, outputSpeech: { type: "PlainText", text } },
});

const slot = (intent, name) => intent?.slots?.[name]?.value?.trim() || "";

async function publish(action, fields = {}) {
  await client.send(new PublishCommand({
    topic,
    qos: 0,
    payload: new TextEncoder().encode(JSON.stringify({ action, ...fields })),
  }));
}

const fixedIntents = {
  OpenMyTvIntent: ["open_my_tv", "Opening My TV."],
  ReturnToMabelTvIntent: ["return_to_mabeltv", "Returning to Mabel TV."],
  ShowTvGuideIntent: ["show_tv_guide", "Opening the TV guide."],
  ShowChannelMenuIntent: ["show_channel_menu", "Opening the channel menu."],
  OpenMenuIntent: ["open_menu", "Opening the menu."],
  CloseIntent: ["close", "Going back."],
  NextChannelIntent: ["next_channel", "Changing channel."],
  PreviousChannelIntent: ["previous_channel", "Changing channel."],
  NextProgrammeIntent: ["next_programme", "Skipping to the next programme."],
  PreviousProgrammeIntent: ["previous_programme", "Going to the previous programme."],
  VolumeUpIntent: ["volume_up", "Turning the volume up."],
  VolumeDownIntent: ["volume_down", "Turning the volume down."],
  MuteIntent: ["mute", "Changing the sound."],
  "AMAZON.PauseIntent": ["pause", "Pausing."],
  "AMAZON.ResumeIntent": ["resume", "Resuming."],
  "AMAZON.NextIntent": ["next_programme", "Skipping to the next programme."],
  "AMAZON.PreviousIntent": ["previous_programme", "Going to the previous programme."],
};

export const handler = async (event) => {
  const request = event?.request || {};
  if (request.type === "LaunchRequest") {
    return reply("Mabel TV is ready. You can ask me to play something, change channel, or open My TV.", false);
  }
  if (request.type !== "IntentRequest") return reply("Goodbye.");
  const intent = request.intent || {};
  if (intent.name === "PlayTitleIntent") {
    const title = slot(intent, "title");
    if (!title) return reply("What would you like Mabel TV to play?", false);
    await publish("play", { title });
    return reply(`Looking for ${title}.`);
  }
  if (intent.name === "TuneChannelIntent") {
    const channel = slot(intent, "channel");
    if (!channel) return reply("Which Mabel TV channel would you like?");
    await publish("tune", { channel });
    return reply(`Changing to ${channel}.`);
  }
  const fixed = fixedIntents[intent.name];
  if (fixed) {
    await publish(fixed[0]);
    return reply(fixed[1]);
  }
  if (intent.name === "AMAZON.HelpIntent") {
    return reply("Try asking Mabel TV to play Postman Pat, change to channel four, or open My TV.", false);
  }
  if (intent.name === "AMAZON.StopIntent" || intent.name === "AMAZON.CancelIntent") {
    return reply("Goodbye.");
  }
  return reply("I did not understand that Mabel TV command. Try asking me to play something or change channel.", false);
};
