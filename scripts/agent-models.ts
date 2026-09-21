async function main() {
  const { getModels, getProviders } = await import('@mariozechner/pi-ai');
  const provider = process.argv[2];
  const providers = getProviders();
  if (!provider) console.log('Providers:\n' + providers.join('\n'));
  else if (providers.includes(provider as typeof providers[number])) {
    console.log(getModels(provider as typeof providers[number]).map(model => model.id).join('\n'));
  } else { console.error('Unknown provider. Run without an argument to list providers.'); process.exitCode = 1; }
}
main().catch(() => { console.error('Unable to read installed model catalog.'); process.exitCode = 1; });
