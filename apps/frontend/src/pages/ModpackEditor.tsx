import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FaArrowLeft } from 'react-icons/fa';
import { packsApi, type Pack } from '../lib/api';
import { pageVariants } from '../lib/motion';
import ModpackPanel from '../components/server/ModpackPanel';

export default function ModpackEditor() {
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<Pack | null>(null);

  // Only fetched here for the "Back to <server>" link's label/target — ModpackPanel does its own
  // (fresher) load of the pack for the actual editor content.
  useEffect(() => {
    if (id) packsApi.get(id).then(setPack).catch(() => undefined);
  }, [id]);

  if (!id) return null;

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" className="mx-auto max-w-5xl px-8 py-10">
      <Link
        to={pack?.servers?.[0] ? `/servers/${pack.servers[0].id}` : '/'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-base-500 hover:text-accent-400"
      >
        <FaArrowLeft className="h-3.5 w-3.5" />
        Back to {pack?.servers?.[0]?.name ?? 'servers'}
      </Link>

      <ModpackPanel packId={id} />
    </motion.div>
  );
}
