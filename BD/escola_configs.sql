-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Tempo de geração: 06/07/2026 às 21:12
-- Versão do servidor: 10.4.32-MariaDB
-- Versão do PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Banco de dados: `chatbot_central`
--

-- --------------------------------------------------------

--
-- Estrutura para tabela `escola_configs`
--

CREATE TABLE `escola_configs` (
  `id_atendimento` int(11) NOT NULL,
  `hash` varchar(64) NOT NULL,
  `cnpj` varchar(20) NOT NULL,
  `nome_fantasia` varchar(150) NOT NULL,
  `status` varchar(20) DEFAULT 'ativo',
  `host` varchar(100) DEFAULT '127.0.0.1',
  `port` int(11) DEFAULT 3050,
  `database_path` varchar(300) NOT NULL,
  `db_user` varchar(100) DEFAULT 'SYSDBA',
  `db_password` varchar(255) NOT NULL,
  `charset` varchar(50) DEFAULT 'UTF8',
  `timezone` varchar(50) DEFAULT 'America/Sao_Paulo',
  `prompt_chatbot` text DEFAULT NULL,
  `ia_model` varchar(100) DEFAULT NULL,
  `whatsapp_config` text DEFAULT NULL,
  `api_keys` text DEFAULT NULL,
  `logo` varchar(255) DEFAULT NULL,
  `colors` varchar(100) DEFAULT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `user_limit` int(11) DEFAULT NULL,
  `message_limit` int(11) DEFAULT NULL,
  `portal_aluno_link` varchar(255) DEFAULT 'https://portal.dksoft.com.br/',
  `cadastro_interessados_link` varchar(255) DEFAULT '',
  `validador_certificado_link` varchar(255) DEFAULT '',
  `theme` varchar(50) DEFAULT 'indigo',
  `emoji` varchar(50) DEFAULT '?',
  `show_financeiro` tinyint(1) DEFAULT 1,
  `show_horarios` tinyint(1) DEFAULT 1,
  `show_boletim` tinyint(1) DEFAULT 1,
  `show_plataforma` tinyint(1) DEFAULT 1,
  `show_conteudo` tinyint(1) DEFAULT 1,
  `show_validador` tinyint(1) DEFAULT 1,
  `show_interessados` tinyint(1) DEFAULT 1,
  `atendimento_numero` varchar(50) DEFAULT '',
  `widget_position` varchar(20) DEFAULT 'right',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `widget_text` varchar(20) DEFAULT 'Posso ajudar?',
  `numero_lancamento` varchar(8) DEFAULT NULL,
  `vencimento` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Despejando dados para a tabela `escola_configs`
--

INSERT INTO `escola_configs` (`id_atendimento`, `hash`, `cnpj`, `nome_fantasia`, `status`, `host`, `port`, `database_path`, `db_user`, `db_password`, `charset`, `timezone`, `prompt_chatbot`, `ia_model`, `whatsapp_config`, `api_keys`, `logo`, `colors`, `domain`, `user_limit`, `message_limit`, `portal_aluno_link`, `cadastro_interessados_link`, `validador_certificado_link`, `theme`, `emoji`, `show_financeiro`, `show_horarios`, `show_boletim`, `show_plataforma`, `show_conteudo`, `show_validador`, `show_interessados`, `atendimento_numero`, `widget_position`, `created_at`, `updated_at`, `widget_text`) VALUES
(32248, 'cc79bf910c8d6c117e1ec4186ea260d9c3ead3c85deb5d7adb559a13d98295ff', '37.156.667/0001-98', 'LARISSA DKSOFT TESTE', 'ativo', '200.150.199.226', 3050, 'e4db356f79193403ddd49208a2dca07a:6a9416e75dfe311aa44c7a67cc616486', 'SYSDBA', '488cefd2363851b56b3ad20b71a086e2:70ec8a93cc4f20bcc1d85da1958eddf3', 'UTF8', 'America/Sao_Paulo', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'https://portal.dksoft.com.br/', 'https://site.com/cadastro', 'https://site.com/validar', 'pink', '🎓', 1, 1, 1, 1, 1, 1, 1, '11994294119', 'right', '2026-07-06 15:10:22', '2026-07-06 18:35:26', 'Posso ajudar?'),
(34380, 'a73e2ec541aeb85540994549b4dbb4ee097fd6e5093e1d452fdc4e1dd4690775', '83.238.411/0001-47', 'LUIGI CURSOS', 'ativo', '200.150.196.107', 3050, '26bbf07322b9553c577a424b381b3fcd:ef70a6a108afd3d7ee7f2ab440fe56f8', 'SYSDBA', '2127d96534f627825347be4d5d30838e:89e25e8631b44d7edba8782ac70fc366', 'UTF8', 'America/Sao_Paulo', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'https://portal.dksoft.com.br/', '', '', 'indigo', '🤖', 1, 1, 1, 1, 1, 1, 1, '', 'right', '2026-07-06 15:10:22', '2026-07-06 15:10:22', 'Posso ajudar?');

--
-- Índices para tabelas despejadas
--

--
-- Índices de tabela `escola_configs`
--
ALTER TABLE `escola_configs`
  ADD PRIMARY KEY (`id_atendimento`),
  ADD UNIQUE KEY `hash` (`hash`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
